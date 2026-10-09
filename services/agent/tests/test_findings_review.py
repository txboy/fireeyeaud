from fireeyeaud_agent.store.findings import (
    create_finding,
    get_finding,
    review_finding,
)


def _mk(tmp_path):
    (tmp_path / ".fireeye").mkdir(exist_ok=True)
    return create_finding(
        tmp_path,
        title="t",
        description="d",
        severity="high",
        dataRefs=[],
        sessionId="s_1",
    )["id"]


def test_review_status_note_severity(tmp_path):
    fid = _mk(tmp_path)
    review_finding(tmp_path, fid, action="confirm", reviewer="审计员", comment="已核实")
    review_finding(tmp_path, fid, action="note", reviewer="审计员", note="取得补充说明")
    review_finding(
        tmp_path,
        fid,
        action="severity",
        reviewer="审计员",
        severity="medium",
        reason="金额偏低",
    )

    found = get_finding(tmp_path, fid)
    assert found["status"] == "confirmed"
    assert found["severity"] == "medium"
    assert found["notes"][-1]["note"]["text"] == "取得补充说明"
    assert found["reviews"][-1]["reviewer"] == "审计员"


def test_review_unknown_returns_none(tmp_path):
    (tmp_path / ".fireeye").mkdir(exist_ok=True)
    assert review_finding(tmp_path, "F-9999", action="confirm", reviewer="x") is None
