import json

from fireeyeaud_agent.agent.tool_output import render_tool_result


def test_small_result_is_returned_verbatim():
    result = {"columns": ["a"], "rows": [[1], [2]], "rowCount": 2}
    text = render_tool_result(result, tool="sql_query", root=None, max_chars=10_000)
    assert json.loads(text) == result


def test_large_result_is_truncated_and_persisted(tmp_path):
    result = {"rows": [[str(i) * 50] for i in range(1000)]}
    text = render_tool_result(
        result, tool="sql_query", root=tmp_path, max_chars=2_000
    )
    payload = json.loads(text)
    assert payload["truncated"] is True
    assert payload["artifactRef"].startswith("artifacts/")
    assert payload["originalChars"] > 2_000
    assert len(text) < 4_000
    assert (tmp_path / ".fireeye" / payload["artifactRef"]).exists()


def test_truncated_payload_keeps_head_and_tail():
    result = {"rows": [["HEAD"] + ["x"] * 5000 + ["TAIL"]]}
    text = render_tool_result(result, tool="t", root=None, max_chars=1_000)
    payload = json.loads(text)
    assert "HEAD" in payload["head"]
    assert "TAIL" in payload["tail"]


def test_prune_keeps_recent_tool_messages_and_shrinks_old_ones():
    from langchain_core.messages import AIMessage, ToolMessage

    from fireeyeaud_agent.agent.tool_output import prune_tool_messages

    big = "x" * 5000
    messages = [
        AIMessage(content="", tool_calls=[{"name": "sql_query", "args": {}, "id": "1"}]),
        ToolMessage(content=big, tool_call_id="1"),
        AIMessage(content="", tool_calls=[{"name": "sql_query", "args": {}, "id": "2"}]),
        ToolMessage(content=big, tool_call_id="2"),
        AIMessage(content="", tool_calls=[{"name": "sql_query", "args": {}, "id": "3"}]),
        ToolMessage(content=big, tool_call_id="3"),
    ]
    changed = prune_tool_messages(messages, keep_last=1, max_chars=500)
    assert changed >= 1
    assert len(messages[1].content) < 1000
    assert messages[5].content == big
    assert "已裁剪" in messages[1].content
