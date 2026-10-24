"""旧取证单一次性迁移：清产物与回执、改写报告引用、编号归零。

旧格式的取证单（manifest 里 `files` 不含 `body.json`）由「选模板 → 渲染一次 docx」生成；
写作台上线后这些产物不再能编辑，因此一次性清除，并同步把报告里指向它们的引用与快照剔除。
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

from . import evidence_forms
from .fsutil import write_json_atomic
from .lock import WORKSPACE_MUTATION_LOCK
from .project import load_project, save_project

MARKER_KEY = "evidenceFormWorkspace"
MARKER_VERSION = 1
NEW_FORM_FILES = "body.json"


def _marker_path(root: Path) -> Path:
    return Path(root) / ".fireeye" / "migrations.json"


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


_FORM_DIR = re.compile(r"QZ-\d{4,}")


def _is_legacy(manifest: dict[str, Any], entry_name: str = "") -> bool:
    """只认「旧取证单」：实质是取证单目录、编号形如 QZ-xxxx、且没有新格式的 body.json。"""
    if manifest.get("kind") != evidence_forms.KIND:
        return False
    if not _FORM_DIR.fullmatch(str(manifest.get("id") or entry_name)):
        return False
    return NEW_FORM_FILES not in (manifest.get("files") or [])


def _remove_legacy_forms(root: Path) -> list[str]:
    base = evidence_forms.forms_dir(root)
    if not base.is_dir():
        return []
    removed: list[str] = []
    receipts_dir = evidence_forms.receipts_dir(root)
    for entry in list(base.iterdir()):
        manifest = _read_json(entry / "manifest.json")
        if manifest is None or not _is_legacy(manifest, entry.name):
            continue
        form_id = str(manifest.get("id") or entry.name)
        receipt = manifest.get("receipt") or {}
        rel = receipt.get("path") if isinstance(receipt, dict) else None
        if rel:
            try:
                (root / rel).unlink(missing_ok=True)
            except OSError:
                pass
        if receipts_dir.is_dir():
            for stale in receipts_dir.glob(f"{form_id}_*"):
                try:
                    stale.unlink(missing_ok=True)
                except OSError:
                    pass
        shutil.rmtree(entry, ignore_errors=True)
        removed.append(form_id)
    return removed


def _rewrite_reports(root: Path, removed: set[str]) -> list[str]:
    if not removed:
        return []
    base = root / ".fireeye" / "artifacts" / "reports"
    if not base.is_dir():
        return []
    updated: list[str] = []
    for entry in base.iterdir():
        path = entry / "manifest.json"
        manifest = _read_json(path)
        if manifest is None or manifest.get("kind") != "report":
            continue
        form_ids = [str(item) for item in manifest.get("formIds") or []]
        snapshots = list(manifest.get("formsSnapshot") or [])
        next_ids = [item for item in form_ids if item not in removed]
        next_snapshots = [
            item for item in snapshots if str(item.get("id") or "") not in removed
        ]
        if next_ids == form_ids and len(next_snapshots) == len(snapshots):
            continue
        manifest["formIds"] = next_ids
        manifest["formsSnapshot"] = next_snapshots
        manifest["findingCount"] = sum(
            len(item.get("findings") or []) for item in next_snapshots
        )
        if "document.docx" in (manifest.get("files") or []):
            manifest["status"] = "draft"
            # 旧 docx 里还引用着已清理的取证单，留着会让「下载」拿到与正文不一致的版本。
            manifest["files"] = [
                name for name in manifest.get("files") or [] if name != "document.docx"
            ]
            warnings = list(manifest.get("exportWarnings") or [])
            note = "部分取证单已被清理，请重新导出报告。"
            if note not in warnings:
                warnings.append(note)
            manifest["exportWarnings"] = warnings
        write_json_atomic(path, manifest)
        updated.append(entry.name)
    return updated


def _reset_counter(root: Path) -> None:
    """清库后才把编号归零；没有旧取证单时保持计数器，避免把新编号拉回 QZ-0001。"""
    fe = root / ".fireeye"
    project = load_project(fe)
    if project is None:
        return
    counters = project.setdefault("counters", {})
    if counters.get("evidenceForm") == 0:
        return
    counters["evidenceForm"] = 0
    save_project(fe, project)


def migrate_evidence_form_workspace(root: Path) -> dict[str, Any]:
    """跑一次旧取证单清理；已跑过则直接返回 ran=False。"""
    root = Path(root)
    marker = _read_json(_marker_path(root)) or {}
    if int(marker.get(MARKER_KEY) or 0) >= MARKER_VERSION:
        return {
            "ran": False,
            "removedForms": [],
            "removedReceipts": 0,
            "updatedReports": [],
        }

    with WORKSPACE_MUTATION_LOCK:
        removed = _remove_legacy_forms(root)
        staging = evidence_forms.staging_dir(root)
        if staging.is_dir():
            shutil.rmtree(staging, ignore_errors=True)
        updated_reports = _rewrite_reports(root, set(removed))
        if removed:
            _reset_counter(root)
        marker[MARKER_KEY] = MARKER_VERSION
        write_json_atomic(_marker_path(root), marker)

    return {
        "ran": True,
        "removedForms": removed,
        "removedReceipts": len(removed),
        "updatedReports": updated_reports,
    }