"""MCP 执行层客户端（Phase 9）：三传输连接 + `tools/list` + `tools/call`。

- 与 `store/mcp.py`（配置 CRUD）区分：这里负责真正连接与调用。
- 生命周期：`open_session` 为异步上下文管理器，每次 `run_agent` 按需连接、`finally` 关闭。
- 凭据：`apiKeyRef` 经 `store.secrets` 取值 → HTTP 头 / stdio 子进程 env，不落盘不写日志。
- MCP SDK 采用惰性导入，避免无 SDK 环境下导入本模块即失败。
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator

from ..config.settings import settings
from ..store import secrets


@dataclass(frozen=True)
class McpToolSpec:
    """MCP 工具描述的精简投影。"""

    name: str
    description: str
    input_schema: dict[str, Any]


def _timeout() -> float:
    return float(getattr(settings, "mcp_timeout_seconds", 30) or 30)


def stdio_params(server: dict[str, Any], *, workspace: Path | None = None) -> Any:
    """构造 stdio 子进程参数：合并 env、注入凭据与工作区沙箱信息。"""
    from mcp import StdioServerParameters

    env = {str(k): str(v) for k, v in (server.get("env") or {}).items()}
    secret = secrets.get(server.get("apiKeyRef"))
    key_env = server.get("apiKeyEnv")
    if secret and key_env:
        env[str(key_env)] = secret
    if workspace is not None:
        env.setdefault("FIREYEAUD_WORKSPACE", str(workspace))
    return StdioServerParameters(
        command=str(server.get("command") or ""),
        args=[str(a) for a in (server.get("args") or [])],
        env=env,
        cwd=str(workspace) if workspace is not None else None,
    )


def http_headers(server: dict[str, Any]) -> dict[str, str]:
    """HTTP/SSE 传输的鉴权头；有 apiKeyRef 且 secrets 有值时注入 Bearer。"""
    secret = secrets.get(server.get("apiKeyRef"))
    if secret:
        return {"Authorization": f"Bearer {secret}"}
    return {}


def result_text(result: Any) -> str:
    """把 `CallToolResult` 归一化为文本（非文本块以类型占位）。"""
    parts: list[str] = []
    for block in getattr(result, "content", None) or []:
        text = getattr(block, "text", None)
        if text is not None:
            parts.append(str(text))
            continue
        kind = getattr(block, "type", None) or "content"
        uri = getattr(block, "uri", None)
        parts.append(f"[{kind}{' ' + str(uri) if uri else ''}]")
    if not parts and getattr(result, "is_error", False):
        parts.append("MCP tool error")
    return "\n".join(parts)


class McpSession:
    """`ClientSession` 的薄封装，暴露精简的工具发现/调用接口。"""

    def __init__(self, session: Any) -> None:
        self._session = session

    async def list_tools(self) -> list[McpToolSpec]:
        result = await self._session.list_tools()
        specs: list[McpToolSpec] = []
        for tool in getattr(result, "tools", None) or []:
            schema = getattr(tool, "input_schema", None)
            specs.append(
                McpToolSpec(
                    name=str(tool.name),
                    description=str(getattr(tool, "description", "") or ""),
                    input_schema=dict(schema) if isinstance(schema, dict) else {},
                )
            )
        return specs

    async def call_tool(self, name: str, arguments: dict[str, Any] | None) -> Any:
        return await self._session.call_tool(
            name, arguments or {}, read_timeout_seconds=_timeout()
        )


@asynccontextmanager
async def open_session(
    server: dict[str, Any],
    *,
    workspace: Path | None = None,
    timeout: float | None = None,
) -> AsyncIterator[McpSession]:
    """按 `transport` 建立连接并完成 `initialize`；退出时关闭。"""
    from mcp import ClientSession

    transport = str(server.get("transport") or "stdio").lower()
    connect_timeout = float(timeout if timeout is not None else _timeout())
    url = str(server.get("url") or "")

    if transport == "stdio":
        from mcp.client.stdio import stdio_client

        async with stdio_client(stdio_params(server, workspace=workspace)) as (
            read,
            write,
        ):
            async with ClientSession(read, write) as session:
                async with asyncio.timeout(connect_timeout):
                    await session.initialize()
                yield McpSession(session)
        return

    if transport == "sse":
        from mcp.client.sse import sse_client

        async with sse_client(
            url,
            headers=http_headers(server),
            timeout=connect_timeout,
            sse_read_timeout=max(connect_timeout, 300.0),
        ) as (read, write):
            async with ClientSession(read, write) as session:
                async with asyncio.timeout(connect_timeout):
                    await session.initialize()
                yield McpSession(session)
        return

    if transport == "http":
        from mcp.client.streamable_http import (
            create_mcp_http_client,
            streamable_http_client,
        )

        http_client = create_mcp_http_client(headers=http_headers(server))
        async with streamable_http_client(url, http_client=http_client) as streams:
            read, write = streams[0], streams[1]
            async with ClientSession(read, write) as session:
                async with asyncio.timeout(connect_timeout):
                    await session.initialize()
                yield McpSession(session)
        return

    raise ValueError(f"unsupported transport: {transport}")
