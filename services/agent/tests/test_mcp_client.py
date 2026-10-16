"""MCP 执行层客户端（T2）：三传输连接 + tools/list + tools/call。"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from fireeyeaud_agent.mcp import client
from fireeyeaud_agent.store import secrets

_SERVER = Path(__file__).parent / "fixtures" / "mcp_echo_server.py"


def test_stdio_params_injects_env_secret_and_workspace(tmp_path):
    secrets.set_one("sec_1", "SECRET-VALUE")
    try:
        params = client.stdio_params(
            {
                "transport": "stdio",
                "command": "npx",
                "args": ["-y", "server"],
                "env": {"LOG_LEVEL": "info"},
                "apiKeyRef": "sec_1",
                "apiKeyEnv": "FS_API_KEY",
            },
            workspace=tmp_path,
        )
        assert params.command == "npx"
        assert params.args == ["-y", "server"]
        assert params.env["LOG_LEVEL"] == "info"
        assert params.env["FS_API_KEY"] == "SECRET-VALUE"
        assert params.env["FIREYEAUD_WORKSPACE"] == str(tmp_path)
        assert params.cwd == str(tmp_path)
    finally:
        secrets.clear()


def test_stdio_params_omits_secret_when_absent(tmp_path):
    params = client.stdio_params(
        {"transport": "stdio", "command": "node", "apiKeyEnv": "K"},
        workspace=tmp_path,
    )
    assert "K" not in params.env


def test_http_headers_builds_authorization_from_secret():
    secrets.set_one("sec_2", "TOKEN-2")
    try:
        headers = client.http_headers({"transport": "http", "apiKeyRef": "sec_2"})
        assert headers == {"Authorization": "Bearer TOKEN-2"}
    finally:
        secrets.clear()


def test_http_headers_empty_without_secret():
    assert client.http_headers({"transport": "sse"}) == {}


async def test_stdio_session_discovers_and_calls(tmp_path):
    server = {
        "transport": "stdio",
        "command": sys.executable,
        "args": [str(_SERVER)],
    }
    async with client.open_session(server, workspace=tmp_path) as session:
        tools = await session.list_tools()
        names = [t.name for t in tools]
        assert "echo" in names
        spec = next(t for t in tools if t.name == "echo")
        assert "text" in (spec.input_schema.get("properties") or {})

        result = await session.call_tool("echo", {"text": "hi"})
        assert "echo:hi" in client.result_text(result)
