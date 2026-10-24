"""取证单存储：编号、manifest、列表与回执（旧渲染链路已删除）。"""

from __future__ import annotations

from pathlib import Path

import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store import evidence_forms


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