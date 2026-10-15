import pytest
from fake_model import FakeChatModel
from langchain_core.messages import AIMessage

from fireeyeaud_agent.agent.graph import run_agent
from fireeyeaud_agent.store.duckdb import Database


def _seed(tmp_path):
    fe = tmp_path / ".fireeye"
    (fe / "index").mkdir(parents=True)
    db = Database(fe / "workspace.duckdb")
    db.create_table_from_rows("src_ds1_x", ["__row_id", "a"], [["1", "1"]])
    db.close()


@pytest.mark.asyncio
async def test_sse_event_mapping_tool_cycle(tmp_path):
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

    assert types[0] == "status"
    assert events[0]["data"]["phase"] == "planning"
    assert any(
        e["data"].get("phase") == "reflecting" for e in events if e["type"] == "status"
    )

    call = next(e for e in events if e["type"] == "tool_call")
    assert set(call["data"]) >= {"callId", "tool", "params"}
    assert call["data"]["callId"] == "call_1"
    assert "params" in call["data"]

    result = next(e for e in events if e["type"] == "tool_result")
    assert set(result["data"]) >= {"callId", "summary", "ok"}
    assert result["data"]["callId"] == "call_1"
    assert result["data"]["ok"] is True

    assert types[-1] == "done"
    assert "usage" in events[-1]["data"]

    streamed = "".join(e["data"]["delta"] for e in events if e["type"] == "token")
    assert streamed == "分析完成"
    assert all(e["sessionId"] == "s_1" for e in events)
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))


@pytest.mark.asyncio
async def test_sse_token_events_without_tools(tmp_path):
    _seed(tmp_path)
    model = FakeChatModel(messages=iter([AIMessage(content="回答内容")]))
    events = [e async for e in run_agent(tmp_path, "s_1", "问题", "zh-CN", model=model)]
    types = [e["type"] for e in events]
    assert "tool_call" not in types
    assert types[-1] == "done"
    streamed = "".join(e["data"]["delta"] for e in events if e["type"] == "token")
    assert streamed == "回答内容"
