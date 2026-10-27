"""MCP 连接管理器（Phase 9 / 设计 §5.2、§5.4）。

- 生效集合：`enabled ∧ (isDefault ∨ id ∈ 勾选)`。
- 逐个 server 连接 → `tools/list` → 按 `toolsAllow` 过滤 → 包装为 `StructuredTool`。
- 失败隔离：单 server 连接/发现/转换失败只记录 `errors`，不阻断内置工具与其它 server。
- 生命周期：每次 `run_agent` 开始 `build_mcp_tools`（异步上下文栈持有连接），结束时 `aclose()`。
"""

from __future__ import annotations

import json
import time
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any, Awaitable, Callable

from langchain_core.tools import StructuredTool

from ..store import mcp as mcp_store
from . import adapters, client

_ALL = object()


class McpUnavailable(RuntimeError):
    """连接前置校验未通过（禁用 / 未授权网络传输）。"""


class McpToolError(RuntimeError):
    """MCP 工具返回 `isError` 结果。"""


def _connect_guard(server: dict[str, Any]) -> str | None:
    """连接前置校验：禁用或未授权网络传输时返回原因，否则 None。"""
    if not server.get("enabled", True):
        return "server is disabled"
    perms = server.get("permissions") or {}
    transport = str(server.get("transport") or "stdio").lower()
    if transport in {"sse", "http"} and not perms.get("net", False):
        return "network transport disabled by permissions.net"
    return None


# `tools/list` 预览缓存：key = root|serverId|配置指纹，value = (过期时间, specs)。
_TOOLS_CACHE: dict[str, tuple[float, list[client.McpToolSpec]]] = {}


def _clear_tools_cache() -> None:
    _TOOLS_CACHE.clear()


def _fingerprint(server: dict[str, Any]) -> str:
    keys = ("transport", "command", "args", "env", "url", "apiKeyRef", "apiKeyEnv")
    return json.dumps(
        {k: server.get(k) for k in keys}, sort_keys=True, ensure_ascii=False, default=str
    )


def find_server(root: Path | None, server_id: str) -> dict[str, Any] | None:
    for server in mcp_store.list_servers(root):
        if str(server.get("id")) == str(server_id):
            return server
    return None


async def server_tools(
    root: Path,
    server: dict[str, Any],
    *,
    ttl_seconds: float = 60.0,
    open_session: Callable[..., Any] | None = None,
) -> list[client.McpToolSpec]:
    """连接 server 并返回其工具列表（带短 TTL 缓存，供预览/测试）。"""
    reason = _connect_guard(server)
    if reason is not None:
        raise McpUnavailable(reason)
    key = f"{Path(root)}|{server.get('id')}|{_fingerprint(server)}"
    now = time.monotonic()
    hit = _TOOLS_CACHE.get(key)
    if hit is not None and hit[0] > now:
        return hit[1]
    opener = open_session or client.open_session
    async with opener(server, workspace=Path(root)) as session:
        specs = await session.list_tools()
    if ttl_seconds > 0:
        _TOOLS_CACHE[key] = (now + ttl_seconds, specs)
    return specs



def effective_server_ids(root: Path | None, selected: Any = None) -> set[str]:
    """已启用且（默认 ∪ 勾选）的 server id 集合。"""
    chosen = {str(x) for x in (selected or [])}
    ids: set[str] = set()
    for server in mcp_store.list_servers(root):
        if not server.get("enabled", True):
            continue
        sid = str(server.get("id"))
        if server.get("isDefault") or sid in chosen:
            ids.add(sid)
    return ids


def _allowed_tools(tools_allow: Any) -> object:
    """`toolsAllow` → 白名单集合；`["*"]` 表示全部；空表示拒绝全部（R3）。"""
    items = [str(x) for x in (tools_allow or [])]
    if "*" in items:
        return _ALL
    if not items:
        return None
    return set(items)


class McpTools:
    """一轮对话内已就绪的 MCP 工具集合。"""

    def __init__(
        self,
        tools: list[StructuredTool],
        tool_dict: dict[str, Callable[[Path, dict[str, Any]], Awaitable[Any]]],
        servers: list[dict[str, Any]],
        errors: list[dict[str, Any]],
        stack: AsyncExitStack,
    ) -> None:
        self.tools = tools
        self.tool_dict = tool_dict
        self.servers = servers
        self.errors = errors
        self._stack = stack

    async def aclose(self) -> None:
        await self._stack.aclose()


async def build_mcp_tools(
    root: Path,
    server_ids: Any,
    *,
    open_session: Callable[..., Any] | None = None,
) -> McpTools:
    """按 id 连接 MCP server 并返回可用工具（失败隔离）。

    `open_session` 可注入（测试用），默认 `client.open_session`。
    """
    root = Path(root)
    opener = open_session or client.open_session
    stack = AsyncExitStack()
    tools: list[StructuredTool] = []
    tool_dict: dict[str, Any] = {}
    servers: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    used_names: set[str] = set()
    by_id = {str(s.get("id")): s for s in mcp_store.list_servers(root)}

    try:
        for sid in sorted({str(x) for x in (server_ids or [])}):
            server = by_id.get(sid)
            if server is None:
                continue
            name = str(server.get("name") or sid)
            perms = server.get("permissions") or {}
            reason = _connect_guard(server)
            if reason is not None:
                errors.append(
                    {
                        "serverId": sid,
                        "code": "E_MCP_DISABLED"
                        if not server.get("enabled", True)
                        else "E_MCP_NET_DENIED",
                        "message": reason,
                    }
                )
                continue
            allowed = _allowed_tools(perms.get("toolsAllow"))
            if allowed is None:
                errors.append(
                    {
                        "serverId": sid,
                        "code": "E_MCP_NO_TOOLS_ALLOWED",
                        "message": "toolsAllow is empty; no tools exposed",
                    }
                )
                continue
            try:
                session = await stack.enter_async_context(
                    opener(server, workspace=root)
                )
                specs = await session.list_tools()
            except Exception as exc:  # 失败隔离到单 server
                errors.append(
                    {"serverId": sid, "code": "E_MCP_CONNECT", "message": str(exc)}
                )
                continue

            exposed: list[str] = []
            for spec in specs:
                if allowed is not _ALL and spec.name not in allowed:  # type: ignore[operator]
                    continue
                lname = adapters.tool_name(sid, spec.name)
                if lname in used_names:
                    lname = adapters.tool_name(
                        sid, f"{spec.name}_{spec.name}"
                    )  # 稳定去重后缀
                    errors.append(
                        {
                            "serverId": sid,
                            "tool": spec.name,
                            "code": "E_MCP_NAME",
                            "message": "tool name collision after sanitization",
                        }
                    )
                try:
                    schema = adapters.schema_to_model(
                        f"MCPArgs_{sid}_{spec.name}", spec.input_schema
                    )
                except Exception as exc:  # schema 转换失败则跳过该工具
                    errors.append(
                        {
                            "serverId": sid,
                            "tool": spec.name,
                            "code": "E_MCP_SCHEMA",
                            "message": str(exc),
                        }
                    )
                    continue

                async def _call(
                    args: dict[str, Any],
                    _session: Any = session,
                    _tool: str = spec.name,
                ) -> Any:
                    res = await _session.call_tool(_tool, args or {})
                    if getattr(res, "is_error", False):
                        raise McpToolError(
                            client.result_text(res) or f"MCP tool {_tool} failed"
                        )
                    return adapters.normalize_result(res)

                tools.append(
                    adapters.build_tool(
                        name=lname,
                        description=adapters.tool_description(name, spec),
                        args_schema=schema,
                        call=_call,
                    )
                )
                tool_dict[lname] = adapters.dict_entry(_call)
                used_names.add(lname)
                exposed.append(spec.name)

            if exposed:
                servers.append({"serverId": sid, "name": name, "tools": exposed})

        return McpTools(tools, tool_dict, servers, errors, stack)
    except BaseException:
        await stack.aclose()
        raise
