"""MCP 执行层客户端（T2）+ 凭据注入（T7）。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

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


async def test_stdio_secret_reaches_subprocess_env(tmp_path):
    secrets.set_one("sec_9", "TOPSECRET-9")
    try:
        server = {
            "transport": "stdio",
            "command": sys.executable,
            "args": [str(_SERVER)],
            "apiKeyRef": "sec_9",
            "apiKeyEnv": "MY_API_KEY",
        }
        async with client.open_session(server, workspace=tmp_path) as session:
            result = await session.call_tool("show_env", {"name": "MY_API_KEY"})
            assert "TOPSECRET-9" in client.result_text(result)
    finally:
        secrets.clear()


def test_secret_value_not_persisted_to_config(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    root = tmp_path / "ws"
    from fireeyeaud_agent.store import mcp as mcp_store

    secrets.set_one("sec_store", "DO-NOT-PERSIST")
    try:
        server = mcp_store.create_server(
            {
                "name": "s",
                "transport": "stdio",
                "command": "x",
                "apiKeyRef": "sec_store",
                "apiKeyEnv": "K",
                "scope": "project",
            },
            root=root,
        )
        assert server["apiKeyRef"] == "sec_store"
        blob = "\n".join(
            p.read_text("utf-8")
            for p in root.rglob("*")
            if p.is_file()
        )
        assert "DO-NOT-PERSIST" not in blob
        saved = json.loads(
            (root / ".fireeye" / "config" / "mcp.json").read_text("utf-8")
        )
        assert saved["items"][0]["apiKeyRef"] == "sec_store"
    finally:
        secrets.clear()
