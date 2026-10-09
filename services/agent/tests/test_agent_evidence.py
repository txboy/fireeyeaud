import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from fireeyeaud_agent.agent.graph import run_agent
from fireeyeaud_agent.store.duckdb import Database
from fireeyeaud_agent.store.evidence import load_evidence, verify_evidence_chain


def _seed(tmp_path):
    fe = tmp_path / ".fireeye"
    (fe / "index").mkdir(parents=True)
    db = Database(fe / "workspace.duckdb")
    db.create_table_from_rows("src_ds1_x", ["__row_id", "a"], [["1", "1"]])
    db.close()


@pytest.mark.asyncio
async def test_agent_writes_tool_evidence(tmp_path):
    _seed(tmp_path)
    tool_msg = AIMessage(
        content="",
        tool_calls=[{"name": "describe_source", "args": {}, "id": "call_1"}],
    )
    final = AIMessage(content="完成")
    model = GenericFakeChatModel(messages=iter([tool_msg, final]))
    async for _ in run_agent(tmp_path, "s_1", "看看", "zh-CN", model=model):
        pass

    items = load_evidence(tmp_path)
    steps = [e["step"] for e in items]
    assert steps == ["tool_call", "tool_result"]
    assert items[0]["tool"] == "describe_source"
    assert verify_evidence_chain(tmp_path)["ok"] is True
