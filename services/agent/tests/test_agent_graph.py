import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
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
async def test_agent_calls_tool_then_finishes(tmp_path):
    _seed(tmp_path)
    tool_msg = AIMessage(
        content="",
        tool_calls=[{"name": "describe_source", "args": {}, "id": "call_1"}],
    )
    final = AIMessage(content="分析完成")
    model = GenericFakeChatModel(messages=iter([tool_msg, final]))
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
    model = GenericFakeChatModel(messages=iter([tool_msg, final]))
    events = [
        e async for e in run_agent(tmp_path, "s_1", "查关联方", "zh-CN", model=model)
    ]
    finding_events = [e for e in events if e["type"] == "finding"]
    assert len(finding_events) == 1
    assert finding_events[0]["data"]["id"] == "F-0001"
    assert (tmp_path / ".fireeye" / "findings.jsonl").exists()
