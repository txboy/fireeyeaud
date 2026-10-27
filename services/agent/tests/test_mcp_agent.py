"""MCP 接入 run_agent 的行为（T5）：工具并入、可调用、留痕、连接关闭。"""

from __future__ import annotations

import pytest
from fake_model import FakeChatModel
from langchain_core.messages import AIMessage
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from fireeyeaud_agent.agent.graph import run_agent
from fireeyeaud_agent.agent import graph as graph_mod
from fireeyeaud_agent.config import models as models_mod
from fireeyeaud_agent.mcp import manager as manager_mod
from fireeyeaud_agent.store import mcp as mcp_store


class _EchoArgs(BaseModel):
    text: str = Field(description="要回显的文本")


async def test_run_agent_exposes_and_calls_mcp_tools(tmp_path, monkeypatch):
    (tmp_path / ".fireeye").mkdir(parents=True)
    server = mcp_store.create_server(
        {
            "name": "echo-server",
            "transport": "stdio",
            "command": "x",
            "enabled": True,
            "isDefault": True,
            "scope": "project",
            "permissions": {"toolsAllow": ["echo"]},
        },
        root=tmp_path,
    )

    captured: dict = {}

    async def fake_build(root, ids):
        captured["ids"] = set(ids or [])

        async def _call(**kwargs):
            return f"echo:{kwargs.get('text')}"

        async def _entry(_root, args):
            return f"echo:{args.get('text')}"

        tool = StructuredTool.from_function(
            coroutine=_call,
            name="mcp__mcp_1__echo",
            description="[echo-server] echo",
            args_schema=_EchoArgs,
        )

        class _M:
            tools = [tool]
            tool_dict = {"mcp__mcp_1__echo": _entry}
            servers = [
                {"serverId": "mcp_1", "name": "echo-server", "tools": ["echo"]}
            ]

            async def aclose(self):
                captured["closed"] = True

        return _M()

    monkeypatch.setattr(manager_mod, "build_mcp_tools", fake_build)

    model = FakeChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "mcp__mcp_1__echo",
                            "args": {"text": "hi"},
                            "id": "call_1",
                        }
                    ],
                ),
                AIMessage(content="完成"),
            ]
        )
    )
    events = [
        e
        async for e in run_agent(
            tmp_path, "s_1", "调用工具", "zh-CN", model=model, context={}
        )
    ]

    assert captured["ids"] == {server["id"]}
    tool_call = next(e for e in events if e["type"] == "tool_call")
    assert tool_call["data"]["tool"] == "mcp__mcp_1__echo"
    tool_result = next(e for e in events if e["type"] == "tool_result")
    assert tool_result["data"]["ok"] is True
    assert captured.get("closed") is True

    evidence = (tmp_path / ".fireeye" / "evidence.jsonl").read_text("utf-8")
    assert "mcp__mcp_1__echo" in evidence


async def test_run_agent_no_context_skips_mcp(tmp_path, monkeypatch):
    (tmp_path / ".fireeye").mkdir(parents=True)
    captured: dict = {}

    async def fake_build(root, ids):
        captured["ids"] = None if ids is None else set(ids)
        raise AssertionError("must not build MCP tools without context")

    monkeypatch.setattr(manager_mod, "build_mcp_tools", fake_build)
    model = FakeChatModel(messages=iter([AIMessage(content="你好")]))
    events = [e async for e in run_agent(tmp_path, "s_1", "hi", "zh-CN", model=model)]
    assert events[-1]["type"] == "done"
    assert captured == {}


async def test_run_agent_tolerates_mcp_cleanup_failure(tmp_path, monkeypatch):
    (tmp_path / ".fireeye").mkdir(parents=True)

    async def fake_build(root, ids):
        class _M:
            tools: list = []
            tool_dict: dict = {}
            servers: list = []

            async def aclose(self):
                raise RuntimeError("teardown boom")

        return _M()

    monkeypatch.setattr(manager_mod, "build_mcp_tools", fake_build)
    model = FakeChatModel(messages=iter([AIMessage(content="ok")]))
    events = [
        e
        async for e in run_agent(
            tmp_path, "s_1", "hi", "zh-CN", model=model, context={}
        )
    ]
    assert events[-1]["type"] == "done"


async def test_stream_chat_closes_mcp_on_early_abandon(tmp_path, monkeypatch):
    from fireeyeaud_agent.agent.graph import stream_chat
    from fireeyeaud_agent.store.workspace import workspace_manager

    (tmp_path / ".fireeye").mkdir(parents=True)
    workspace_manager.open(str(tmp_path))
    captured: dict = {}

    async def fake_build(root, ids):
        captured["opened"] = True

        class _M:
            tools: list = []
            tool_dict: dict = {}
            servers: list = []

            async def aclose(self):
                captured["closed"] = True

        return _M()

    monkeypatch.setattr(manager_mod, "build_mcp_tools", fake_build)
    monkeypatch.setattr(
        models_mod,
        "build_chat_model",
        lambda *_a, **_k: FakeChatModel(messages=iter([AIMessage(content="hi")])),
    )
    try:
        agen = stream_chat("s_early", "hi", "zh-CN", context={})
        first = await agen.__anext__()
        assert first["event"] == "message"
        assert captured.get("opened") is True
        await agen.aclose()
        assert captured.get("closed") is True
    finally:
        workspace_manager.close()
