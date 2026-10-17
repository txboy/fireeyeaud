"""数据源路由：导入（SSE 进度）与列表（设计 §14.8）。"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import anyio
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from ..errors import ApiError
from ..store.importer import delete_source, import_source
from ..store.project import load_project
from ..store.sync import sync_sources
from ..store.workspace import workspace_manager
from ..util import now_iso
from .deps import require_token

router = APIRouter(tags=["datasources"], dependencies=[Depends(require_token)])


class ImportBody(BaseModel):
    path: str


def _require_root() -> Path:
    if workspace_manager.root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    return workspace_manager.root


@router.get("/datasources")
def list_datasources() -> dict:
    root = workspace_manager.root
    if root is None:
        return {"items": [], "nextCursor": None}
    project = load_project(root / ".fireeye") or {}
    return {"items": project.get("dataSources", []), "nextCursor": None}


@router.delete("/datasources/{source_id}")
def delete_datasource(source_id: str) -> dict:
    root = _require_root()
    return delete_source(root, source_id)


@router.post("/datasources/sync")
async def sync_datasources() -> EventSourceResponse:
    """扫描工作区表格文件并对账：新增导入 / 删除移除 / 修改替换。SSE 回推进度与结果。"""
    root = _require_root()
    session_id = (workspace_manager.current or {}).get("id", "")
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[tuple[str, dict]] = asyncio.Queue()

    def progress(phase: str, done: int, total: int) -> None:
        loop.call_soon_threadsafe(
            queue.put_nowait,
            ("import_progress", {"phase": phase, "done": done, "total": total}),
        )

    def work() -> dict:
        return sync_sources(root, progress=progress)

    async def run() -> None:
        try:
            result = await anyio.to_thread.run_sync(work)
            await queue.put(("done", result))
        except ApiError as exc:
            await queue.put(
                (
                    "error",
                    {
                        "code": exc.code,
                        "messageKey": exc.message_key,
                        "params": exc.params,
                    },
                )
            )

    async def event_stream():
        task = asyncio.create_task(run())
        seq = 0
        while True:
            kind, data = await queue.get()
            seq += 1
            envelope = {
                "type": kind,
                "seq": seq,
                "sessionId": session_id,
                "ts": now_iso(),
                "data": data,
            }
            yield {"event": "message", "data": json.dumps(envelope, ensure_ascii=False)}
            if kind in ("done", "error"):
                break
        await task

    return EventSourceResponse(event_stream(), media_type="text/event-stream")


@router.post("/datasources/import")
async def import_datasource(body: ImportBody) -> EventSourceResponse:
    root = _require_root()
    session_id = (workspace_manager.current or {}).get("id", "")
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[tuple[str, dict]] = asyncio.Queue()

    def progress(phase: str, done: int, total: int) -> None:
        loop.call_soon_threadsafe(
            queue.put_nowait,
            ("import_progress", {"phase": phase, "done": done, "total": total}),
        )

    def work() -> dict:
        return import_source(root, Path(body.path), progress=progress)

    async def run() -> None:
        try:
            result = await anyio.to_thread.run_sync(work)
            await queue.put(
                ("done", {"sourceId": result["sourceId"], "tables": result["tables"]})
            )
        except ApiError as exc:
            await queue.put(
                (
                    "error",
                    {
                        "code": exc.code,
                        "messageKey": exc.message_key,
                        "params": exc.params,
                    },
                )
            )

    async def event_stream():
        task = asyncio.create_task(run())
        seq = 0
        while True:
            kind, data = await queue.get()
            seq += 1
            envelope = {
                "type": kind,
                "seq": seq,
                "sessionId": session_id,
                "ts": now_iso(),
                "data": data,
            }
            yield {"event": "message", "data": json.dumps(envelope, ensure_ascii=False)}
            if kind in ("done", "error"):
                break
        await task

    return EventSourceResponse(event_stream(), media_type="text/event-stream")
