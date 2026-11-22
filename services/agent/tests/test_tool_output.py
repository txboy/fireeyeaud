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
