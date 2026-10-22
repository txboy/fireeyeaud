"""人工证据：文件复制到 证据/、哈希入链、文字/记录证据。"""

from pathlib import Path

import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store.evidence import (
    append_manual_evidence,
    load_evidence,
    verify_evidence_chain,
)
from fireeyeaud_agent.store.findings import create_finding, get_finding


def _manual(root: Path) -> str:
    return create_finding(
        root,
        title="t",
        description="d",
        severity="high",
        dataRefs=[],
        sessionId="",
        origin="manual",
    )["id"]


def test_manual_file_evidence_is_copied_and_hashed(tmp_path):
    fid = _manual(tmp_path)
    src = tmp_path / "回单.pdf"
    src.write_bytes(b"%PDF-1.4 demo")

    ev = append_manual_evidence(
        tmp_path,
        finding_id=fid,
        kind="file",
        title="银行回单",
        note="客户提供",
        source_path=src,
    )

    assert ev["source"] == "manual"
    assert ev["kind"] == "file"
    assert ev["filePath"].startswith("证据/")
    assert ev["fileHash"].startswith("sha256:")
    assert (tmp_path / ev["filePath"]).read_bytes() == b"%PDF-1.4 demo"
    assert get_finding(tmp_path, fid)["evidenceRefs"] == [ev["id"]]
    assert verify_evidence_chain(tmp_path)["ok"] is True


def test_manual_text_evidence(tmp_path):
    fid = _manual(tmp_path)
    ev = append_manual_evidence(
        tmp_path,
        finding_id=fid,
        kind="text",
        title="口头说明",
        note="财务总监称已对账",
    )
    assert ev["filePath"] is None
    assert load_evidence(tmp_path, fid)[0]["title"] == "口头说明"


def test_manual_record_evidence(tmp_path):
    fid = _manual(tmp_path)
    ev = append_manual_evidence(
        tmp_path,
        finding_id=fid,
        kind="record",
        title="现场核查",
        note="抽查 10 笔，均未见签收单",
    )
    assert ev["kind"] == "record"
    assert ev["step"] == "manual"
    assert load_evidence(tmp_path, fid)[0]["note"].startswith("抽查")


def test_manual_file_rejects_unsupported_ext(tmp_path):
    fid = _manual(tmp_path)
    src = tmp_path / "a.exe"
    src.write_bytes(b"x")
    with pytest.raises(ApiError) as exc:
        append_manual_evidence(
            tmp_path, finding_id=fid, kind="file", title="bad", source_path=src
        )
    assert exc.value.code == "E_FILE_TYPE"
    assert get_finding(tmp_path, fid)["evidenceRefs"] == []


def test_manual_file_dedupes_name(tmp_path):
    fid = _manual(tmp_path)
    src = tmp_path / "回单.pdf"
    src.write_bytes(b"one")
    first = append_manual_evidence(
        tmp_path, finding_id=fid, kind="file", title="第一次", source_path=src
    )
    src.write_bytes(b"two")
    second = append_manual_evidence(
        tmp_path, finding_id=fid, kind="file", title="第二次", source_path=src
    )

    assert first["filePath"] != second["filePath"]
    assert (tmp_path / first["filePath"]).read_bytes() == b"one"
    assert (tmp_path / second["filePath"]).read_bytes() == b"two"


def test_manual_evidence_requires_existing_finding(tmp_path):
    src = tmp_path / "a.pdf"
    src.write_bytes(b"x")
    with pytest.raises(ApiError) as exc:
        append_manual_evidence(
            tmp_path, finding_id="F-9999", kind="file", title="x", source_path=src
        )
    assert exc.value.code == "E_NOT_FOUND"


def test_manual_file_evidence_requires_path(tmp_path):
    fid = _manual(tmp_path)
    with pytest.raises(ApiError) as exc:
        append_manual_evidence(tmp_path, finding_id=fid, kind="file", title="x")
    assert exc.value.code == "E_FILE_REQUIRED"