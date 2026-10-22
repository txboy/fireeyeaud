import json

from fireeyeaud_agent.store.findings import (
    attach_evidence,
    create_finding,
    delete_finding,
    detach_evidence,
    get_finding,
    load_findings,
)
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


def test_create_rule_finding_links_evidence(tmp_path):
    from fireeyeaud_agent.store.evidence import append_evidence
    from fireeyeaud_agent.store.findings import get_finding

    root = _ws(tmp_path)
    ev = append_evidence(root, session_id="s_1", step="tool_result", tool="t")
    rec = create_finding(
        root,
        title=None,
        description=None,
        severity="high",
        dataRefs=[],
        sessionId="s_1",
        origin="rule",
        ruleKey="tie_check",
        evidenceRefs=[ev["id"]],
    )
    assert rec["title"] is None
    assert rec["description"] is None
    assert rec["origin"] == "rule"
    assert rec["ruleKey"] == "tie_check"
    assert get_finding(root, rec["id"])["evidenceRefs"] == [ev["id"]]

def test_manual_finding_create_and_soft_delete(tmp_path):
    created = create_finding(
        tmp_path,
        title="手工疑点",
        description="说明",
        severity="high",
        dataRefs=[],
        sessionId="",
        origin="manual",
        author="张审计",
    )
    assert created["id"] == "F-0001"
    assert created["origin"] == "manual"
    assert created["author"] == "张审计"

    items = load_findings(tmp_path)
    assert [i["id"] for i in items] == ["F-0001"]
    assert items[0]["deleted"] is False

    deleted = delete_finding(tmp_path, "F-0001", author="张审计")
    assert deleted is not None
    assert deleted["event"] == "deleted"
    assert load_findings(tmp_path) == []
    assert get_finding(tmp_path, "F-0001") is None
    assert delete_finding(tmp_path, "F-9999", author="张审计") is None


def test_attach_and_detach_evidence(tmp_path):
    create_finding(
        tmp_path,
        title="t",
        description="d",
        severity="high",
        dataRefs=[],
        sessionId="",
        origin="manual",
    )
    attach_evidence(tmp_path, "F-0001", "ev_1", author="张审计")
    attach_evidence(tmp_path, "F-0001", "ev_1", author="张审计")
    assert get_finding(tmp_path, "F-0001")["evidenceRefs"] == ["ev_1"]

    detach_evidence(tmp_path, "F-0001", "ev_1", author="张审计")
    assert get_finding(tmp_path, "F-0001")["evidenceRefs"] == []

    # 不存在的疑点/未挂接的证据 → 不写事件
    assert attach_evidence(tmp_path, "F-9999", "ev_1") is None
    assert detach_evidence(tmp_path, "F-0001", "ev_1") is None


def test_deleted_finding_rejects_further_events(tmp_path):
    create_finding(
        tmp_path,
        title="t",
        description="d",
        severity="high",
        dataRefs=[],
        sessionId="",
        origin="manual",
    )
    delete_finding(tmp_path, "F-0001")
    assert attach_evidence(tmp_path, "F-0001", "ev_1") is None
    assert delete_finding(tmp_path, "F-0001") is None
