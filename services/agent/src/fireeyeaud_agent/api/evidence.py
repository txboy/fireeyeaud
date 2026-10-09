"""证据查询路由（设计 §14.8）。"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends

from ..errors import ApiError
from ..store.evidence import load_evidence
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["evidence"], dependencies=[Depends(require_token)])


def _root() -> Path:
    if workspace_manager.root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    return workspace_manager.root


@router.get("/evidence")
def list_evidence(findingId: str | None = None, limit: int = 200) -> dict:
    if workspace_manager.root is None:
        return {"items": [], "nextCursor": None}
    items = load_evidence(workspace_manager.root, findingId, max(1, min(limit, 500)))
    return {"items": items, "nextCursor": None}
