import json

from fireeyeaud_agent.store.findings import create_finding
from fireeyeaud_agent.store.project import load_project


def _ws(tmp_path):
    fe = tmp_path / ".fireeye"
    (fe / "config").mkdir(parents=True)
    (fe / "project.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "id": "p1",
                "name": "t",
                "counters": {"finding": 0},
                "dataSources": [],
            }
        ),
        "utf-8",
    )
    return tmp_path


def test_create_finding_assigns_id_and_seq(tmp_path):
    root = _ws(tmp_path)
    ev = create_finding(
        root,
        title="大额关联方",
        description="desc",
        severity="high",
        dataRefs=[{"sourceId": "ds_1", "table": "t", "rowRef": "1"}],
        sessionId="s_1",
    )
    assert ev["id"] == "F-0001"
    assert ev["seq"] == 1
    assert ev["event"] == "created"
    assert ev["title"] == {"lang": "zh-CN", "text": "大额关联方"}
    assert ev["origin"] == "agent"
    assert ev["status"] == "pending"
    assert load_project(root / ".fireeye")["counters"]["finding"] == 1
    assert (root / ".fireeye" / "findings.jsonl").read_text("utf-8").strip()


def test_create_two_findings_increments(tmp_path):
    root = _ws(tmp_path)
    first = create_finding(
        root, title="a", description="d", severity="low", dataRefs=[], sessionId="s_1"
    )
    second = create_finding(
        root, title="b", description="d", severity="low", dataRefs=[], sessionId="s_1"
    )
    assert first["id"] == "F-0001"
    assert second["id"] == "F-0002"
    assert second["seq"] == 2
