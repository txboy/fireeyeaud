"""MCP Server 路由（设计 §14.8；本期仅配置）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..config import store
from ..store import mcp
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["mcp"], dependencies=[Depends(require_token)])


class ServerBody(BaseModel):
    name: str
    transport: str = "stdio"
    command: str | None = None
    args: list[str] | None = None
    env: dict | None = None
    url: str | None = None
    apiKeyRef: str | None = None
    apiKeyEnv: str | None = None
    enabled: bool = True
    scope: str = "global"
    permissions: dict | None = None
    isDefault: bool = False


class ServerPatch(BaseModel):
    name: str | None = None
    transport: str | None = None
    command: str | None = None
    enabled: bool | None = None
    permissions: dict | None = None
    args: list[str] | None = None
    env: dict | None = None
    url: str | None = None
    apiKeyRef: str | None = None
    apiKeyEnv: str | None = None
    isDefault: bool | None = None


@router.get("/mcp/servers")
def list_servers(scope: str | None = Query(default=None)) -> dict:
    root = workspace_manager.root
    if scope in ("global", "project"):
        return {"items": store.list_items(mcp.KIND, scope, root), "nextCursor": None}
    return {"items": mcp.list_servers(root), "nextCursor": None}


@router.post("/mcp/servers")
def create_server(body: ServerBody) -> dict:
    return mcp.create_server(body.model_dump(), workspace_manager.root)


@router.patch("/mcp/servers/{server_id}")
def update_server(
    server_id: str, body: ServerPatch, scope: str = Query(default="global")
) -> dict:
    return mcp.update_server(
        server_id, scope, body.model_dump(exclude_unset=True), workspace_manager.root
    )


@router.delete("/mcp/servers/{server_id}")
def delete_server(server_id: str, scope: str = Query(default="global")) -> dict:
    mcp.delete_server(server_id, scope, workspace_manager.root)
    return {"ok": True}
