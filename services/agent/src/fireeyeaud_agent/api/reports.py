"""项目报告路由：旧模板生成 + 新报告工作台（草稿 / 大纲 / 章节 / 校验 / 导出 / 对话）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from ..agent.report_agent import stream_report_chat
from ..errors import ApiError
from ..store import report_docs, reports
from ..store.report_verify import verify_report
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["reports"], dependencies=[Depends(require_token)])

Scope = Literal["global", "project"]


def _root() -> Path:
    root = workspace_manager.root
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    return Path(root)


class PreviewBody(BaseModel):
    templateId: str
    templateScope: Scope
    formIds: list[str]
    header: dict[str, str] = {}


class CommitBody(BaseModel):
    token: str
    title: str | None = None


class DraftBody(BaseModel):
    templateId: str
    templateScope: Scope
    formIds: list[str] = []
    header: dict[str, str] = {}
    title: str | None = None


class OutlineBody(BaseModel):
    sections: list[dict[str, Any]]
    approved: bool = False


class SectionBody(BaseModel):
    blocks: list[dict[str, Any]] = []


class TitleBody(BaseModel):
    title: str


class ExportBody(BaseModel):
    title: str | None = None


class ReportChatBody(BaseModel):
    message: str = ""
    locale: str | None = None
    modelId: str | None = None


@router.post("/reports/preview")
def preview(body: PreviewBody) -> dict:
    return reports.preview_report(
        _root(),
        template_id=body.templateId,
        template_scope=body.templateScope,
        form_ids=body.formIds,
        header=body.header,
    )


@router.post("/reports", status_code=201)
def commit(body: CommitBody) -> dict:
    return reports.commit_report(_root(), body.token, body.title)


@router.post("/reports/drafts", status_code=201)
def create_draft(body: DraftBody) -> dict:
    return report_docs.create_report(
        _root(),
        template_id=body.templateId,
        template_scope=body.templateScope,
        form_ids=body.formIds,
        header=body.header,
        title=body.title,
    )


@router.get("/reports")
def list_all() -> dict:
    return {"items": reports.list_reports(_root())}


@router.get("/reports/{report_id}")
def get_one(report_id: str) -> dict:
    return reports.get_report(_root(), report_id)


@router.get("/reports/{report_id}/doc")
def get_doc(report_id: str) -> dict:
    return report_docs.get_document(_root(), report_id)


@router.put("/reports/{report_id}/outline")
def put_outline(report_id: str, body: OutlineBody) -> dict:
    return report_docs.set_outline(
        _root(), report_id, body.sections, approved=body.approved
    )


@router.put("/reports/{report_id}/sections/{section_id}")
def put_section(report_id: str, section_id: str, body: SectionBody) -> dict:
    return report_docs.write_section(_root(), report_id, section_id, body.blocks)


@router.put("/reports/{report_id}/title")
def put_title(report_id: str, body: TitleBody) -> dict:
    return report_docs.set_title(_root(), report_id, body.title)


@router.post("/reports/{report_id}/verify")
def verify(report_id: str) -> dict:
    return verify_report(_root(), report_id)


@router.post("/reports/{report_id}/export")
def export(report_id: str, body: ExportBody) -> dict:
    return report_docs.export_report(_root(), report_id, title=body.title)


@router.get("/reports/{report_id}/messages")
def messages(report_id: str) -> dict:
    return {"items": report_docs.load_chat(_root(), report_id, limit=200)}


@router.post("/reports/{report_id}/chat")
async def chat(report_id: str, body: ReportChatBody) -> EventSourceResponse:
    async def generate():
        async for event in stream_report_chat(
            _root(),
            report_id,
            body.message,
            model_id=body.modelId,
            locale=body.locale,
        ):
            yield {
                "event": str(event.get("event") or "message"),
                "data": json.dumps(event.get("data") or {}, ensure_ascii=False),
            }

    return EventSourceResponse(generate(), media_type="text/event-stream")


@router.delete("/reports/{report_id}")
def remove(report_id: str) -> dict:
    reports.delete_report(_root(), report_id)
    return {"ok": True}
