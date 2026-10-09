"""证据图谱路由（设计 §14.8 / §14.11）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..store.graph import build_graph
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["graph"], dependencies=[Depends(require_token)])


@router.get("/graph")
def get_graph(findingId: str | None = None) -> dict:
    if workspace_manager.root is None:
        return {"nodes": [], "edges": []}
    return build_graph(workspace_manager.root, findingId)
