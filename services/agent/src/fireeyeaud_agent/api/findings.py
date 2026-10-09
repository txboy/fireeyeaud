"""findings 查询路由（设计 §14.8）。"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends

from ..errors import ApiError
from ..store.findings import get_finding, load_findings
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


@router.get("/findings/{finding_id}")
def finding_detail(finding_id: str) -> dict:
    item = get_finding(_root(), finding_id)
    if item is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": finding_id})
    return item
