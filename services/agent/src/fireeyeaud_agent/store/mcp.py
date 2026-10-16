"""MCP Server 配置存储（设计 §14 / §10；执行层见 `mcp/` 包）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import store

KIND = "mcp"
_TRANSPORTS = {"stdio", "sse", "http"}


def list_servers(root: Path | None = None) -> list[dict[str, Any]]:
    return store.load_effective(KIND, root)


def get_server(
    server_id: str, scope: str, root: Path | None = None
) -> dict[str, Any] | None:
    return store.get_item(KIND, server_id, scope, root)


def create_server(data: dict[str, Any], root: Path | None = None) -> dict[str, Any]:
    from ..errors import ApiError

    transport = str(data.get("transport") or "").lower()
    if transport not in _TRANSPORTS:
        raise ApiError(
            "E_MCP_TRANSPORT", 400, "error.mcpTransport", {"transport": transport}
        )
    payload = dict(data)
    payload["transport"] = transport
    perms = payload.get("permissions") or {}
    payload["permissions"] = {
        "fsScope": perms.get("fsScope", "workspace"),
        "net": bool(perms.get("net", False)),
        "toolsAllow": list(perms.get("toolsAllow") or []),
    }
    if payload.get("env"):
        payload["env"] = {str(k): str(v) for k, v in payload["env"].items()}
    return store.create_item(KIND, payload, root)


def update_server(
    server_id: str, scope: str, patch: dict[str, Any], root: Path | None = None
) -> dict[str, Any]:
    return store.update_item(KIND, server_id, scope, patch, root)


def delete_server(server_id: str, scope: str, root: Path | None = None) -> None:
    store.delete_item(KIND, server_id, scope, root)
