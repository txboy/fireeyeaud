import asyncio

import pytest
from fake_model import FakeChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage

from fireeyeaud_agent.agent.graph import run_agent
from fireeyeaud_agent.config.settings import settings
from fireeyeaud_agent.store.duckdb import Database


def _seed(tmp_path):
    fe = tmp_path / ".fireeye"
    (fe / "index").mkdir(parents=True)
    db = Database(fe / "workspace.duckdb")
    db.create_table_from_rows("src_ds1_x", ["__row_id", "a"], [["1", "1"]])
    db.close()


@pytest.mark.asyncio
async def test_agent_calls_tool_then_finishes(tmp_path):
    _seed(tmp_path)
    tool_msg = AIMessage(
        content="",
        tool_calls=[{"name": "describe_source", "args": {}, "id": "call_1"}],
    )
    final = AIMessage(content="分析完成")
    model = FakeChatModel(messages=iter([tool_msg, final]))
    events = [
        e async for e in run_agent(tmp_path, "s_1", "看看表结构", "zh-CN", model=model)
    ]
    types = [e["type"] for e in events]
    assert "tool_call" in types
    assert "tool_result" in types
    assert types[-1] == "done"
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    tool_call = next(e for e in events if e["type"] == "tool_call")
    assert tool_call["data"]["tool"] == "describe_source"


@pytest.mark.asyncio
async def test_agent_reports_finding(tmp_path):
    _seed(tmp_path)
    tool_msg = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "report_finding",
                "args": {
                    "title": "大额关联方",
                    "description": "疑似未披露",
                    "severity": "high",
                },
                "id": "call_1",
            }
        ],
    )
    final = AIMessage(content="已记录疑点")
    model = FakeChatModel(messages=iter([tool_msg, final]))
    events = [
        e async for e in run_agent(tmp_path, "s_1", "查关联方", "zh-CN", model=model)
    ]
    finding_events = [e for e in events if e["type"] == "finding"]
    assert len(finding_events) == 1
    assert finding_events[0]["data"]["id"] == "F-0001"
    assert (tmp_path / ".fireeye" / "findings.jsonl").exists()


@pytest.mark.asyncio
async def test_agent_streams_answer_tokens(tmp_path):
    _seed(tmp_path)
    model = FakeChatModel(messages=iter([AIMessage(content="分析完成")]))
    events = [e async for e in run_agent(tmp_path, "s_1", "你好", "zh-CN", model=model)]
    text = "".join(e["data"]["delta"] for e in events if e["type"] == "token")
    assert text == "分析完成"


@pytest.mark.asyncio
async def test_agent_empty_response_yields_error(tmp_path):
    _seed(tmp_path)
    model = FakeChatModel(messages=iter([AIMessage(content="")]))
    events = [e async for e in run_agent(tmp_path, "s_1", "你好", "zh-CN", model=model)]
    errors = [e for e in events if e["type"] == "error"]
    assert errors and errors[0]["data"]["messageKey"] == "error.emptyResponse"
    assert events[-1]["type"] == "done"


class _StepCapturingModel:
    """记录每次模型调用的 messages，首步返回工具调用，第二步返回正文。"""

    def __init__(self) -> None:
        self.calls: list = []

    def bind_tools(self, _tools):
        return self

    async def astream(self, messages):
        self.calls.append(list(messages))
        if len(self.calls) == 1:
            yield AIMessageChunk(
                content="",
                tool_calls=[{"name": "describe_source", "args": {}, "id": "call_1"}],
            )
        else:
            yield AIMessageChunk(content="完成")


@pytest.mark.asyncio
async def test_attachment_first_step_image_then_text(tmp_path):
    """首步直传原图，第 2 步改为附件文本。"""
    _seed(tmp_path)
    from PIL import Image

    from fireeyeaud_agent.store import attachments as att

    image = tmp_path / "pic.png"
    Image.new("RGB", (60, 40), "white").save(image)
    encoded = att.encode_image_file(image)
    assert encoded is not None
    block = {
        "type": "image_url",
        "image_url": {"url": f"data:{encoded[0]};base64,{encoded[1]}"},
    }
    texts = [{"name": "pic.png", "text": "发票金额 1000", "source": "vision"}]
    model = _StepCapturingModel()

    events = [
        e
        async for e in run_agent(
            tmp_path,
            "s_1",
            "看图",
            "zh-CN",
            model=model,
            attachment_texts=texts,
            image_blocks=[block],
        )
    ]
    assert events[-1]["type"] == "done"

    step1_human = next(m for m in model.calls[0] if isinstance(m.content, list))
    assert step1_human.content[1]["type"] == "image_url"
    assert not any(isinstance(m.content, list) for m in model.calls[1])
    assert any(
        isinstance(m.content, str) and "发票金额 1000" in m.content
        for m in model.calls[1]
    )


class _FileReadingModel:
    def __init__(self, path: str) -> None:
        self.path = path
        self.calls: list = []

    def bind_tools(self, _tools):
        return self

    async def astream(self, messages):
        self.calls.append(list(messages))
        if len(self.calls) == 1:
            yield AIMessageChunk(
                content="",
                tool_calls=[
                    {"name": "read_file", "args": {"path": self.path}, "id": "call_1"}
                ],
            )
        else:
            yield AIMessageChunk(content="完成")


@pytest.mark.asyncio
async def test_agent_reads_workspace_file(tmp_path):
    _seed(tmp_path)
    (tmp_path / "说明.md").write_text("hello workspace file", encoding="utf-8")
    model = _FileReadingModel("说明.md")

    events = [
        e async for e in run_agent(tmp_path, "s_1", "读取说明.md", "zh-CN", model=model)
    ]
    assert events[-1]["type"] == "done"
    tool_result = next(e for e in events if e["type"] == "tool_result")
    assert tool_result["data"]["ok"] is True

    tool_msgs = [m for m in model.calls[1] if isinstance(m, ToolMessage)]
    assert tool_msgs and "hello workspace file" in tool_msgs[0].content


class _HangingModel:
    """持续产出空块（模拟推理阶段），永不结束。"""

    def bind_tools(self, _tools):
        return self

    async def astream(self, _messages):
        while True:
            await asyncio.sleep(0.05)
            yield AIMessageChunk(content="")


@pytest.mark.asyncio
async def test_agent_model_timeout_yields_error(tmp_path, monkeypatch):
    _seed(tmp_path)
    monkeypatch.setattr(settings, "turn_timeout_seconds", 0.2)
    events = [
        e
        async for e in run_agent(
            tmp_path, "s_1", "你好", "zh-CN", model=_HangingModel()
        )
    ]
    errors = [e for e in events if e["type"] == "error"]
    assert errors and errors[0]["data"]["messageKey"] == "error.llmTimeout"
    assert events[-1]["type"] == "done"
