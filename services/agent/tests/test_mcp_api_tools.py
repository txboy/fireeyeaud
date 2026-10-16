"""MCP 连通性测试与工具预览路由（T8）。"""

from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.mcp import manager


def _patch_connector(monkeypatch, *, specs=None, fail=False, counter=None):
    calls = counter if counter is not None else {"n": 0}

    @asynccontextmanager
    async def fake_open(server, *, workspace=None):
        calls["n"] += 1
        if fail:
            raise RuntimeError("connect refused")

        class _Session:
            async def list_tools(self):
                return list(specs or [])

            async def call_tool(self, name, arguments):
                raise AssertionError("not used")

        yield _Session()

    monkeypatch.setattr(manager.client, "open_session", fake_open)
    manager._clear_tools_cache()
    return calls


async def _open_and_create(client, tmp_path, body_extra=None):
    await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")})
    body = {
        "name": "echo-server",
        "transport": "stdio",
        "command": "x",
        "enabled": True,
        "scope": "project",
    }
    body.update(body_extra or {})
    res = await client.post("/api/v1/mcp/servers", json=body)
    assert res.status_code == 200
    return res.json()["id"]


async def test_test_route_returns_tools(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws").mkdir()
    from fireeyeaud_agent.mcp.client import McpToolSpec

    _patch_connector(
        monkeypatch,
        specs=[McpToolSpec(name="echo", description="回显", input_schema={})],
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        sid = await _open_and_create(client, tmp_path)
        res = await client.post(f"/api/v1/mcp/servers/{sid}/test")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["tools"] == [{"name": "echo", "description": "回显"}]


async def test_test_route_reports_connection_error(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws").mkdir()
    _patch_connector(monkeypatch, fail=True)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        sid = await _open_and_create(client, tmp_path)
        res = await client.post(f"/api/v1/mcp/servers/{sid}/test")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False
    assert "connect refused" in body["error"]


async def test_test_route_unknown_server(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws").mkdir()
    _patch_connector(monkeypatch)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")})
        res = await client.post("/api/v1/mcp/servers/mcp_999/test")
    assert res.status_code == 404


async def test_tools_route_uses_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws").mkdir()
    from fireeyeaud_agent.mcp.client import McpToolSpec

    calls = _patch_connector(
        monkeypatch,
        specs=[McpToolSpec(name="echo", description="回显", input_schema={})],
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        sid = await _open_and_create(client, tmp_path)
        first = await client.get(f"/api/v1/mcp/servers/{sid}/tools")
        second = await client.get(f"/api/v1/mcp/servers/{sid}/tools")
    assert first.status_code == 200
    assert first.json()["tools"][0]["name"] == "echo"
    assert second.json()["tools"][0]["name"] == "echo"
    assert calls["n"] == 1
