"""旧取证单一次性迁移：清产物与回执、改写报告引用、编号归零、幂等。"""

from __future__ import annotations

import json
from pathlib import Path

from fireeyeaud_agent.store import evidence_forms, migrate


def _root(tmp_path: Path) -> Path:
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)
    (root / ".fireeye" / "project.json").write_text(
        json.dumps({"name": "示例项目", "counters": {"evidenceForm": 7}}), "utf-8"
    )
    return root


def _legacy_form(root: Path, form_id: str) -> None:
    directory = evidence_forms.forms_dir(root) / form_id
    directory.mkdir(parents=True)
    (directory / "manifest.json").write_text(
        json.dumps(
            {
                "id": form_id,
                "kind": "evidence-form",
                "title": "旧取证单",
                "files": ["document.docx", "template.docx"],
                "findingsSnapshot": [
                    {"id": "F-0001", "title": "关联方", "description": "未披露"}
                ],
            },
            ensure_ascii=False,
        ),
        "utf-8",
    )
    (directory / "document.docx").write_bytes(b"old")
    receipts = root / "回执单"
    receipts.mkdir(exist_ok=True)
    (receipts / f"{form_id}_客户签收.pdf").write_bytes(b"%PDF")


def _report(root: Path, report_id: str, form_ids: list[str], finding_count: int) -> Path:
    directory = root / ".fireeye" / "artifacts" / "reports" / report_id
    directory.mkdir(parents=True)
    manifest = {
        "id": report_id,
        "kind": "report",
        "status": "saved",
        "title": "报告",
        "formIds": form_ids,
        "formsSnapshot": [
            {"id": fid, "title": "旧取证单", "findings": [{"id": "F-0001"}]}
            for fid in form_ids
        ],
        "findingCount": finding_count,
        "files": ["manifest.json", "body.json", "document.docx"],
    }
    (directory / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), "utf-8"
    )
    return directory


def test_migration_removes_legacy_and_rewrites_reports(tmp_path):
    root = _root(tmp_path)
    _legacy_form(root, "QZ-0001")
    _legacy_form(root, "QZ-0002")
    report_dir = _report(root, "RPT-0001", ["QZ-0001", "QZ-0002"], 2)
    staging = root / ".fireeye" / "staging" / "abc"
    staging.mkdir(parents=True)

    result = migrate.migrate_evidence_form_workspace(root)

    assert result["ran"] is True
    assert sorted(result["removedForms"]) == ["QZ-0001", "QZ-0002"]
    assert not (evidence_forms.forms_dir(root) / "QZ-0001").exists()
    assert not (root / "回执单").exists() or not any((root / "回执单").iterdir())
    assert not (root / ".fireeye" / "staging").exists()

    manifest = json.loads((report_dir / "manifest.json").read_text("utf-8"))
    assert manifest["formIds"] == []
    assert manifest["formsSnapshot"] == []
    assert manifest["findingCount"] == 0
    assert manifest["status"] == "draft"
    assert manifest["exportWarnings"]

    project = json.loads((root / ".fireeye" / "project.json").read_text("utf-8"))
    assert project["counters"]["evidenceForm"] == 0


def test_migration_is_idempotent_and_keeps_new_forms(tmp_path):
    root = _root(tmp_path)
    _legacy_form(root, "QZ-0001")
    migrate.migrate_evidence_form_workspace(root)

    # 迁移后新建的取证单（有新格式 body.json）不能被二次清理
    new_dir = evidence_forms.forms_dir(root) / "QZ-0002"
    new_dir.mkdir(parents=True)
    (new_dir / "body.json").write_text("{}", "utf-8")
    (new_dir / "manifest.json").write_text(
        json.dumps({"id": "QZ-0002", "kind": "evidence-form", "files": ["body.json"]}),
        "utf-8",
    )

    again = migrate.migrate_evidence_form_workspace(root)
    assert again["ran"] is False
    assert new_dir.is_dir()


def test_migration_leaves_untouched_when_nothing_to_do(tmp_path):
    root = _root(tmp_path)
    result = migrate.migrate_evidence_form_workspace(root)
    assert result["ran"] is True
    assert result["removedForms"] == []
    marker = json.loads((root / ".fireeye" / "migrations.json").read_text("utf-8"))
    assert marker["evidenceFormWorkspace"] == 1