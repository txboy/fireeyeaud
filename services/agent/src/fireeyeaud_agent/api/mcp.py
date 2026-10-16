"""MCP Server 路由（设计 §14.8；本期仅配置）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..config import store
from ..errors import ApiError
from ..mcp import manager as mcp_manager
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


def _require_server(server_id: str) -> dict:
    root = workspace_manager.root
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    server = mcp_manager.find_server(root, server_id)
    if server is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": server_id})
    return server


def _tool_items(specs: list) -> list[dict]:
    return [{"name": s.name, "description": s.description} for s in specs]


@router.post("/mcp/servers/{server_id}/test")
async def test_server(server_id: str) -> dict:
    """连接 + `tools/list`，返回连通性与工具预览（设计 §5.7）。"""
    server = _require_server(server_id)
    try:
        specs = await mcp_manager.server_tools(
            workspace_manager.root, server, ttl_seconds=0
        )
    except Exception as exc:  # noqa: BLE001 - 连通性失败以结构化结果返回
        return {"ok": False, "tools": [], "error": str(exc)}
    return {"ok": True, "tools": _tool_items(specs)}


@router.get("/mcp/servers/{server_id}/tools")
async def server_tools(server_id: str) -> dict:
    """工具列表预览（短 TTL 缓存，设计 §5.7）。"""
    server = _require_server(server_id)
    try:
        specs = await mcp_manager.server_tools(workspace_manager.root, server)
    except Exception as exc:  # noqa: BLE001 - 失败以空列表 + error 返回
        return {"tools": [], "error": str(exc)}
    return {"tools": _tool_items(specs)}
