
from fireeyeaud_agent.store.jsonl import append_event, next_seq, read_events


def test_append_and_read_roundtrip(tmp_path):
    path = tmp_path / "findings.jsonl"
    append_event(path, {"event": "created", "id": "F-0001"})
    append_event(path, {"event": "note_added", "id": "F-0001"})
    events = read_events(path)
    assert [e["event"] for e in events] == ["created", "note_added"]
    assert [e["seq"] for e in events] == [1, 2]


def test_next_seq_on_missing_file(tmp_path):
    assert next_seq(tmp_path / "none.jsonl") == 1


def test_truncate_partial_last_line(tmp_path):
    path = tmp_path / "findings.jsonl"
    path.write_text('{"event":"created","seq":1}\n{"event":"note', encoding="utf-8")
    events = read_events(path)
    assert len(events) == 1
    assert events[0]["seq"] == 1
