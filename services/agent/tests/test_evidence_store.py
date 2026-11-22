from pathlib import Path

from fireeyeaud_agent.store.evidence import (
    append_evidence,
    compute_hash,
    load_evidence,
    verify_evidence_chain,
)
from fireeyeaud_agent.store.jsonl import read_events as read_events_original


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


def test_verify_detects_tampering(tmp_path: Path) -> None:
    root = tmp_path
    (root / ".fireeye").mkdir()
    append_evidence(root, session_id="s_1", step="tool_call", tool="a")
    append_evidence(root, session_id="s_1", step="tool_result", tool="a")
    append_evidence(root, session_id="s_1", step="tool_call", tool="b")

    path = root / ".fireeye" / "evidence.jsonl"
    lines = path.read_text("utf-8").splitlines()
    lines[1] = lines[1].replace("tool_result", "tool_call")
    path.write_text("\n".join(lines) + "\n", "utf-8")

    report = verify_evidence_chain(root)
    assert report["ok"] is False
    assert report["breakAt"] == 2


def test_append_does_not_full_scan(monkeypatch, tmp_path):
    from fireeyeaud_agent.store import evidence as evidence_store
    from fireeyeaud_agent.store import jsonl

    def _boom(*_a, **_k):
        raise AssertionError("append path must not read the whole JSONL")

    monkeypatch.setattr(jsonl, "read_events", _boom)
    monkeypatch.setattr(evidence_store, "read_events", _boom)

    for i in range(5):
        evidence_store.append_evidence(
            tmp_path,
            session_id="s_1",
            step="tool_result",
            tool="sql_query",
            params={"sql": "SELECT 1"},
            result_summary=f"{i} 行",
            result={"rowCount": i},
            lang="zh-CN",
        )

    events = read_events_original(evidence_store.evidence_path(tmp_path))
    assert [e["seq"] for e in events] == [1, 2, 3, 4, 5]
    assert events[0]["prevHash"] == ""
    for prev, cur in zip(events, events[1:]):
        assert cur["prevHash"] == prev["hash"]
