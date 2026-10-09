"""findings 查询路由（设计 §14.8）。"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..errors import ApiError
from ..store.findings import get_finding, load_findings, review_finding
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["findings"], dependencies=[Depends(require_token)])

_MAX_LIMIT = 200


def _root() -> Path:
    if workspace_manager.root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    return workspace_manager.root


@router.get("/findings")
def list_findings(
    severity: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> dict:
    if workspace_manager.root is None:
        return {"items": [], "nextCursor": None}
    items = load_findings(workspace_manager.root)
    if severity:
        items = [i for i in items if i.get("severity") == severity]
    if status:
        items = [i for i in items if i.get("status") == status]
    limit = max(1, min(int(limit), _MAX_LIMIT))
    return {"items": items[:limit], "nextCursor": None}


class ReviewBody(BaseModel):
    action: str
    reviewer: str = "审计员"
    comment: str | None = None
    note: str | None = None
    noteLang: str = "zh-CN"
    severity: str | None = None
    reason: str | None = None


@router.get("/findings/{finding_id}")
def finding_detail(finding_id: str) -> dict:
    item = get_finding(_root(), finding_id)
    if item is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": finding_id})
    return item


@router.post("/findings/{finding_id}/review")
def review(finding_id: str, body: ReviewBody) -> dict:
    result = review_finding(
        _root(),
        finding_id,
        action=body.action,
        reviewer=body.reviewer,
        comment=body.comment,
        note=body.note,
        note_lang=body.noteLang,
        severity=body.severity,
        reason=body.reason,
    )
    if result is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": finding_id})
    return result
