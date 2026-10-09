from fireeyeaud_agent.tools.base import dump_artifact, summarize


def test_dump_artifact_writes_json(tmp_path):
    ref = dump_artifact(tmp_path, "ev_42", {"rows": list(range(100))})
    assert ref == "artifacts/ev_42.json"
    assert (tmp_path / ".fireeye" / "artifacts" / "ev_42.json").exists()


def test_summarize_truncates():
    rows = [{"a": i} for i in range(1000)]
    out = summarize(rows, limit=5)
    assert out["rowCount"] == 1000
    assert len(out["rows"]) == 5
    assert out["truncated"] is True


def test_summarize_no_truncate():
    out = summarize([{"a": 1}], limit=5)
    assert out["rowCount"] == 1
    assert out["truncated"] is False
