import asyncio

import pytest
from langchain_core.messages import AIMessageChunk

from fireeyeaud_agent.agent.doc_chat import run_tool_loop
from fireeyeaud_agent.config.settings import settings


class _EchoTool:
    def invoke(self, args):
        return {"echo": args.get("text")}


class _TwoCallModel:
    def __init__(self):
        self.calls = 0

    def bind_tools(self, _tools):
        return self

    async def astream(self, messages):
        self.calls += 1
        if self.calls == 1:
            yield AIMessageChunk(
                content="",
                tool_calls=[
                    {"name": "echo", "args": {"text": "a"}, "id": None},
                    {"name": "echo", "args": {"text": "b"}, "id": None},
                ],
            )
        else:
            yield AIMessageChunk(content="完成")


@pytest.mark.asyncio
async def test_doc_chat_generates_distinct_call_ids():
    model = _TwoCallModel()
    events = [
        e
        async for e in run_tool_loop(
            model,
            [],
            {"echo": _EchoTool()},
            mutated_names=set(),
            on_assistant_text=lambda _t: None,
            revision=lambda: "r1",
        )
    ]
    assert any(e["event"] == "done" for e in events)


class _HangModel:
    def bind_tools(self, _tools):
        return self

    async def astream(self, _messages):
        await asyncio.sleep(10)
        yield AIMessageChunk(content="")


@pytest.mark.asyncio
async def test_doc_chat_model_timeout(monkeypatch):
    monkeypatch.setattr(settings, "turn_timeout_seconds", 0.05)
    events = [
        e
        async for e in run_tool_loop(
            _HangModel(),
            [],
            {},
            mutated_names=set(),
            on_assistant_text=lambda _t: None,
            revision=lambda: "r1",
        )
    ]
    assert events[0]["event"] == "error"
    assert events[0]["data"]["messageKey"] == "error.llmTimeout"
