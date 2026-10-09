from pathlib import Path

from fireeyeaud_agent.store.evidence import (
    append_evidence,
    compute_hash,
    load_evidence,
    verify_evidence_chain,
)


def test_append_evidence_builds_hash_chain(tmp_path: Path) -> None:
    root = tmp_path
    (root / ".fireeye").mkdir()
    first = append_evidence(
        root,
        session_id="s_1",
        step="tool_call",
        tool="sql_query",
        params={"sql": "SELECT 1"},
        result_summary="1 行",
    )
    assert first["id"] == "ev_1"
    assert first["seq"] == 1
    assert first["prevHash"] == ""
    assert first["hash"].startswith("sha256:")

    second = append_evidence(
        root,
        session_id="s_1",
        step="tool_result",
        tool="sql_query",
        result_summary="命中 1 行",
        result={"rows": [["1"]]},
    )
    assert second["id"] == "ev_2"
    assert second["prevHash"] == first["hash"]

    assert compute_hash(first["prevHash"], first) == first["hash"]

    items = load_evidence(root)
    assert [e["id"] for e in items] == ["ev_1", "ev_2"]

    report = verify_evidence_chain(root)
    assert report["ok"] is True
    assert report["count"] == 2
