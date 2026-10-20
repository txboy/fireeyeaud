import json

from fireeyeaud_agent.store.fsutil import write_json_atomic


def test_write_json_atomic_replaces_content_without_leftover_temp(tmp_path):
    target = tmp_path / "data.json"
    target.write_text('{"old": true}', encoding="utf-8")

    write_json_atomic(target, {"new": [1, 2, 3]})

    assert json.loads(target.read_text("utf-8")) == {"new": [1, 2, 3]}
    assert [p.name for p in tmp_path.iterdir()] == ["data.json"]
