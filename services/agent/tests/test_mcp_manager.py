"""MCP 连接管理器（T4）：生效集合、白名单、失败隔离、生命周期。"""

from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace

from fireeyeaud_agent.mcp import manager
from fireeyeaud_agent.mcp.client import McpToolSpec


def _server(sid, **kw):
    base = {
        "id": sid,
        "name": sid,
        "transport": "stdio",
        "command": "echo",
        "enabled": True,
        "isDefault": False,
        "scope": "project",
        "permissions": {"fsScope": "workspace", "net": False, "toolsAllow": ["echo"]},
    }
    base.update(kw)
    return base


class _FakeSession:
    def __init__(self, specs, opened):
        self._specs = specs
        self._opened = opened

    async def list_tools(self):
        return list(self._specs)

    async def call_tool(self, name, arguments):
        text = f"{name}:{arguments.get('text')}"
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=text)], is_error=False
        )


def _connector(servers, *, fail=()):
    """构造假 open_session：按 server id 返回伪 session；fail 中的 id 抛错。"""
    opened: dict[str, list] = {}

    @asynccontextmanager
    async def fake_open(server, *, workspace=None):
        sid = server["id"]
        if sid in fail:
            raise RuntimeError(f"boom:{sid}")
        specs = [
            McpToolSpec(name=t, description=f"{t} desc", input_schema=_schema(t))
            for t in (server.get("_tools") or ["echo", "danger"])
        ]
        session = _FakeSession(specs, opened)
        opened[sid] = opened.get(sid, [])
        try:
            yield session
        finally:
            opened[sid].append("closed")

    return fake_open, opened


def _schema(name):
    return {
        "type": "object",
        "properties": {"text": {"type": "string"}},
        "required": ["text"],
    }


def test_effective_ids_enabled_and_default_or_selected(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    root = tmp_path / "ws"
    _write_servers(
        root,
        [
            _server("mcp_1", isDefault=True),
            _server("mcp_2"),
            _server("mcp_3", enabled=False, isDefault=True),
        ],
    )
    assert manager.effective_server_ids(root, ["mcp_2"]) == {"mcp_1", "mcp_2"}
    assert manager.effective_server_ids(root, None) == {"mcp_1"}


async def test_build_tools_respects_tools_allow(tmp_path, monkeypatch):
    root = _workspace(tmp_path, monkeypatch)
    _write_servers(
        root,
        [_server("mcp_1", permissions={"toolsAllow": ["echo"]})],
    )
    fake_open, _ = _connector({})
    result = await manager.build_mcp_tools(root, {"mcp_1"}, open_session=fake_open)
    try:
        names = [t.name for t in result.tools]
        assert names == ["mcp__mcp_1__echo"]
        assert "mcp__mcp_1__danger" not in result.tool_dict
    finally:
        await result.aclose()


async def test_build_tools_empty_allow_denies_all(tmp_path, monkeypatch):
    root = _workspace(tmp_path, monkeypatch)
    _write_servers(root, [_server("mcp_1", permissions={"toolsAllow": []})])
    fake_open, _ = _connector({})
    result = await manager.build_mcp_tools(root, {"mcp_1"}, open_session=fake_open)
    try:
        assert result.tools == []
        assert any(e.get("code") == "E_MCP_NO_TOOLS_ALLOWED" for e in result.errors)
    finally:
        await result.aclose()


async def test_build_tools_allow_star_exposes_all(tmp_path, monkeypatch):
    root = _workspace(tmp_path, monkeypatch)
    _write_servers(root, [_server("mcp_1", permissions={"toolsAllow": ["*"]})])
    fake_open, _ = _connector({})
    result = await manager.build_mcp_tools(root, {"mcp_1"}, open_session=fake_open)
    try:
        assert {t.name for t in result.tools} == {
            "mcp__mcp_1__echo",
            "mcp__mcp_1__danger",
        }
    finally:
        await result.aclose()


async def test_build_tools_denies_network_transport(tmp_path, monkeypatch):
    root = _workspace(tmp_path, monkeypatch)
    _write_servers(
        root,
        [
            _server(
                "mcp_1",
                transport="http",
                url="http://x",
                permissions={"net": False, "toolsAllow": ["echo"]},
            )
        ],
    )
    fake_open, _ = _connector({})
    result = await manager.build_mcp_tools(root, {"mcp_1"}, open_session=fake_open)
    try:
        assert result.tools == []
        assert any(e.get("code") == "E_MCP_NET_DENIED" for e in result.errors)
    finally:
        await result.aclose()


async def test_build_tools_isolates_failing_server(tmp_path, monkeypatch):
    root = _workspace(tmp_path, monkeypatch)
    _write_servers(
        root,
        [
            _server("mcp_1"),
            _server("mcp_2"),
        ],
    )
    fake_open, _ = _connector({}, fail=("mcp_1",))
    result = await manager.build_mcp_tools(
        root, {"mcp_1", "mcp_2"}, open_session=fake_open
    )
    try:
        assert [t.name for t in result.tools] == ["mcp__mcp_2__echo"]
        assert any(e.get("serverId") == "mcp_1" for e in result.errors)
    finally:
        await result.aclose()


async def test_tool_call_returns_normalized_text(tmp_path, monkeypatch):
    root = _workspace(tmp_path, monkeypatch)
    _write_servers(root, [_server("mcp_1", permissions={"toolsAllow": ["echo"]})])
    fake_open, _ = _connector({})
    result = await manager.build_mcp_tools(root, {"mcp_1"}, open_session=fake_open)
    try:
        out = await result.tool_dict["mcp__mcp_1__echo"](root, {"text": "hi"})
        assert out == "echo:hi"
    finally:
        await result.aclose()


async def test_aclose_closes_sessions(tmp_path, monkeypatch):
    root = _workspace(tmp_path, monkeypatch)
    _write_servers(root, [_server("mcp_1")])
    fake_open, opened = _connector({})
    result = await manager.build_mcp_tools(root, {"mcp_1"}, open_session=fake_open)
    await result.aclose()
    assert opened["mcp_1"] == ["closed"]


def _workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    return tmp_path / "ws"


def _write_servers(root, servers):
    from fireeyeaud_agent.config import store

    for server in servers:
        store.put_item("mcp", {**server, "scope": "project"}, root)
