"""MCP 连接管理器（Phase 9 / 设计 §5.2、§5.4）。

- 生效集合：`enabled ∧ (isDefault ∨ id ∈ 勾选)`。
- 逐个 server 连接 → `tools/list` → 按 `toolsAllow` 过滤 → 包装为 `StructuredTool`。
- 失败隔离：单 server 连接/发现/转换失败只记录 `errors`，不阻断内置工具与其它 server。
- 生命周期：每次 `run_agent` 开始 `build_mcp_tools`（异步上下文栈持有连接），结束时 `aclose()`。
"""

from __future__ import annotations

from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any, Awaitable, Callable

from langchain_core.tools import StructuredTool

from ..store import mcp as mcp_store
from . import adapters, client

_ALL = object()


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
    by_id = {str(s.get("id")): s for s in mcp_store.list_servers(root)}

    try:
        for sid in sorted({str(x) for x in (server_ids or [])}):
            server = by_id.get(sid)
            if server is None or not server.get("enabled", True):
                continue
            name = str(server.get("name") or sid)
            perms = server.get("permissions") or {}
            transport = str(server.get("transport") or "stdio").lower()
            if transport in {"sse", "http"} and not perms.get("net", False):
                errors.append(
                    {
                        "serverId": sid,
                        "code": "E_MCP_NET_DENIED",
                        "message": "network transport disabled by permissions.net",
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
            except Exception as exc:  # noqa: BLE001 - 失败隔离到单 server
                errors.append(
                    {"serverId": sid, "code": "E_MCP_CONNECT", "message": str(exc)}
                )
                continue

            exposed: list[str] = []
            for spec in specs:
                if allowed is not _ALL and spec.name not in allowed:  # type: ignore[operator]
                    continue
                lname = adapters.tool_name(sid, spec.name)
                try:
                    schema = adapters.schema_to_model(
                        f"MCPArgs_{sid}_{spec.name}", spec.input_schema
                    )
                except Exception as exc:  # noqa: BLE001 - schema 转换失败则跳过该工具
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
                exposed.append(spec.name)

            if exposed:
                servers.append({"serverId": sid, "name": name, "tools": exposed})

        return McpTools(tools, tool_dict, servers, errors, stack)
    except BaseException:
        await stack.aclose()
        raise
