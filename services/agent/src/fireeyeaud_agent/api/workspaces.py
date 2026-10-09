"""工作区路由（打开 / 当前 / 关闭）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["workspaces"], dependencies=[Depends(require_token)])


class OpenBody(BaseModel):
    path: str


@router.post("/workspaces/open")
def open_workspace(body: OpenBody) -> dict:
    return workspace_manager.open(body.path)


@router.get("/workspaces/current")
def current_workspace() -> dict:
    return {"workspace": workspace_manager.current}


@router.post("/workspaces/close")
def close_workspace() -> dict:
    workspace_manager.close()
    return {"closed": True}
