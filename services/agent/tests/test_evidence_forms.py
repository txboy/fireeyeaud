"""取证单存储：编号、manifest、列表与回执（旧渲染链路已删除）。"""

from __future__ import annotations

from pathlib import Path

import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store import evidence_forms, form_docs

from test_form_docs import _setup


def _root(tmp_path: Path) -> Path:
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)
    return root


def test_next_form_id_starts_at_one(tmp_path):
    root = _root(tmp_path)
    assert evidence_forms.next_form_id(root) == "QZ-0001"


def test_next_form_id_never_collides_with_existing_dir(tmp_path):
    root = _root(tmp_path)
    occupied = evidence_forms.forms_dir(root) / "QZ-0001"
    occupied.mkdir(parents=True)
    assert evidence_forms.next_form_id(root) == "QZ-0002"


def test_load_manifest_rejects_bad_id_and_missing(tmp_path):
    root = _root(tmp_path)
    for bad in ("../etc", "RPT-0001", "QZ-1"):
        with pytest.raises(ApiError):
            evidence_forms.load_manifest(root, bad)
    with pytest.raises(ApiError) as exc:
        evidence_forms.load_manifest(root, "QZ-9999")
    assert exc.value.code == "E_NOT_FOUND"


def test_save_and_list_manifests(tmp_path):
    root = _root(tmp_path)
    for form_id, stamp in (
        ("QZ-0001", "2026-10-01T00:00:00+00:00"),
        ("QZ-0002", "2026-10-02T00:00:00+00:00"),
    ):
        directory = evidence_forms.forms_dir(root) / form_id
        directory.mkdir(parents=True)
        evidence_forms.save_manifest(
            root,
            {
                "id": form_id,
                "kind": "evidence-form",
                "title": form_id,
                "createdAt": stamp,
            },
        )
    items = evidence_forms.list_evidence_forms(root)
    assert [item["id"] for item in items] == ["QZ-0002", "QZ-0001"]


def test_snapshot_finding_shape():
    finding = {
        "id": "F-0001",
        "title": "关联方交易",
        "description": "未披露",
        "severity": "high",
        "status": "confirmed",
        "subjects": ["其他应收款"],
        "amount": "99",
        "currency": "CNY",
        "evidenceRefs": ["E-0001"],
    }
    snap = evidence_forms.snapshot_finding(Path("."), finding)
    assert snap["id"] == "F-0001"
    assert snap["title"] == "关联方交易"
    assert snap["amount"] == "99"
    assert snap["evidence"] == ["E-0001"]

def test_receipt_write_does_not_clobber_concurrent_section_save(tmp_path):
    """回执是锁外读、锁内写：必须锁内重读，否则会把并发的 status 变更覆盖回 draft。"""
    import threading

    root, template_id, finding_id = _setup(tmp_path)
    form_docs.create_form(
        root, template_id=template_id, template_scope="project", finding_ids=[finding_id]
    )
    form_docs.set_outline(root, "QZ-0001", [{"title": "一、事项经过", "level": 1}], approved=True)
    form_docs.write_section(
        root,
        "QZ-0001",
        "S1",
        [{"type": "paragraph", "text": "正文。", "sourceRefs": [finding_id]}],
    )
    manifest = evidence_forms.load_manifest(root, "QZ-0001")
    manifest["status"] = "saved"
    evidence_forms.save_manifest(root, manifest)

    receipt = tmp_path / "客户签收.pdf"
    receipt.write_bytes(b"%PDF")
    errors: list[BaseException] = []

    def attach():
        try:
            evidence_forms.attach_receipt(root, "QZ-0001", receipt)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    def save():
        try:
            current = evidence_forms.load_manifest(root, "QZ-0001")
            current["status"] = "saved"
            evidence_forms.save_manifest(root, current)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=attach) for _ in range(5)]
    threads += [threading.Thread(target=save) for _ in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    final = evidence_forms.load_manifest(root, "QZ-0001")
    assert final["receipt"]["name"] == "客户签收.pdf"
    assert final["status"] == "saved", "回执写入不能把状态回滚成 draft"
