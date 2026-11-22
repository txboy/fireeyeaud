
from fireeyeaud_agent.store.jsonl import append_event, next_seq, read_events


def _write_lines(path, count):
    import json

    with path.open("w", encoding="utf-8") as fh:
        for i in range(1, count + 1):
            fh.write(json.dumps({"seq": i, "hash": f"h{i}"}) + "\n")


def test_last_event_reads_tail_only(tmp_path):
    from fireeyeaud_agent.store import jsonl

    path = tmp_path / "events.jsonl"
    _write_lines(path, 50_000)
    assert jsonl.last_event(path) == {"seq": 50_000, "hash": "h50000"}


def test_last_event_ignores_partial_trailing_line(tmp_path):
    from fireeyeaud_agent.store import jsonl

    path = tmp_path / "events.jsonl"
    _write_lines(path, 3)
    with path.open("a", encoding="utf-8") as fh:
        fh.write('{"seq": 4, "ha')
    assert jsonl.last_event(path) == {"seq": 3, "hash": "h3"}


def test_last_event_empty_and_missing(tmp_path):
    from fireeyeaud_agent.store import jsonl

    assert jsonl.last_event(tmp_path / "nope.jsonl") is None
    empty = tmp_path / "empty.jsonl"
    empty.write_text("", encoding="utf-8")
    assert jsonl.last_event(empty) is None


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
