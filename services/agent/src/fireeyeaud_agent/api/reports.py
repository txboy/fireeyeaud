"""项目报告路由：预览、保存、列表。"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..errors import ApiError
from ..store import reports
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


@router.get("/reports")
def list_all() -> dict:
    return {"items": reports.list_reports(_root())}


@router.get("/reports/{report_id}")
def get_one(report_id: str) -> dict:
    return reports.get_report(_root(), report_id)


@router.delete("/reports/{report_id}")
def remove(report_id: str) -> dict:
    reports.delete_report(_root(), report_id)
    return {"ok": True}