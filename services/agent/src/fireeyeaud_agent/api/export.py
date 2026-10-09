"""工作底稿导出与产物读取（设计 §14.8 / §14.15）。"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..errors import ApiError
from ..store.working_paper import create_working_paper, list_working_papers
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["export"], dependencies=[Depends(require_token)])


class ExportBody(BaseModel):
    findingIds: list[str] | None = None
    format: str
    locale: str = "zh-CN"
    templateId: str | None = None


@router.get("/export/working-paper")
def get_working_papers() -> dict:
    if workspace_manager.root is None:
        return {"items": []}
    return {"items": list_working_papers(workspace_manager.root)}


@router.post("/export/working-paper")
def post_working_paper(body: ExportBody) -> dict:
    if workspace_manager.root is None:
        raise ApiError("E_NO_WORKSPACE", 400, "error.noWorkspace")
    return create_working_paper(
        workspace_manager.root,
        format=body.format,
        locale=body.locale,
        finding_ids=body.findingIds,
        template_id=body.templateId or "default",
    )


@router.get("/artifacts/{path:path}")
def get_artifact(path: str) -> FileResponse:
    if workspace_manager.root is None:
        raise ApiError("E_NO_WORKSPACE", 400, "error.noWorkspace")
    base = (Path(workspace_manager.root) / ".fireeye" / "artifacts").resolve()
    target = (base / path).resolve()
    if base not in target.parents:
        raise ApiError("E_ARTIFACT_NOT_FOUND", 404, "error.artifactNotFound")
    if not target.is_file():
        raise ApiError("E_ARTIFACT_NOT_FOUND", 404, "error.artifactNotFound")
    return FileResponse(target)
