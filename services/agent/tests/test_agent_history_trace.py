from fireeyeaud_agent.agent.graph import _history_entries
from fireeyeaud_agent.store.evidence import append_evidence


def test_history_entries_include_recent_tool_trace(tmp_path):
    fe = tmp_path / ".fireeye"
    fe.mkdir()
    append_evidence(
        tmp_path,
        session_id="s_1",
        step="tool_call",
        tool="sql_query",
        params={"sql": "SELECT a FROM src_ds1_x"},
        lang="zh-CN",
    )
    append_evidence(
        tmp_path,
        session_id="s_1",
        step="tool_result",
        tool="sql_query",
        params={"sql": "SELECT a FROM src_ds1_x"},
        result_summary="2 行",
        result={"rowCount": 2},
        lang="zh-CN",
    )

    entries = _history_entries(fe, "s_1")
    assert entries, "至少要有轨迹条目"
    trace = "\n".join(e["text"] for e in entries)
    assert "sql_query" in trace
    assert "SELECT a FROM src_ds1_x" in trace
    assert "2 行" in trace


def test_history_trace_is_isolated_per_session(tmp_path):
    fe = tmp_path / ".fireeye"
    fe.mkdir()
    append_evidence(
        tmp_path,
        session_id="s_2",
        step="tool_result",
        tool="sql_query",
        params={"sql": "SELECT secret FROM t"},
        result_summary="1 行",
        lang="zh-CN",
    )
    entries = _history_entries(fe, "s_1")
    assert all("secret" not in e["text"] for e in entries)
