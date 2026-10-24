"""取证单：编号分配、manifest 读写、回执单与旧数据迁移。

正文由 ``form_docs`` 管理（结构化 body.json）；本模块只管「这一份取证单是什么」。
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..util import now_iso
from .fsutil import write_json_atomic
from .lock import WORKSPACE_MUTATION_LOCK
from .project import next_counter

KIND = "evidence-form"
ARTIFACT_DIR = "evidence-forms"
_FORM_ID = re.compile(r"QZ-\d{4,}")

SEVERITY_LABEL = {"high": "高", "medium": "中", "low": "低"}
STATUS_LABEL = {
    "pending": "待复核",
    "in_review": "复核中",
    "confirmed": "已确认",
    "rejected": "已驳回",
    "false_positive": "误报",
}

RECEIPT_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".docx"}
RECEIPT_MAX = 20 * 1024 * 1024


# ---- 路径 ----


def artifacts_root(root: Path) -> Path:
    return Path(root) / ".fireeye" / "artifacts"


def forms_dir(root: Path) -> Path:
    return artifacts_root(root) / ARTIFACT_DIR


def staging_dir(root: Path) -> Path:
    return Path(root) / ".fireeye" / "staging"


def receipts_dir(root: Path) -> Path:
    return Path(root) / "回执单"


def _posix(path: Path, root: Path) -> str:
    return path.relative_to(Path(root)).as_posix()


def _manifest_path(root: Path, form_id: str) -> Path:
    return forms_dir(root) / form_id / "manifest.json"


# ---- 疑点快照 ----


def snapshot_finding(root: Path, finding: dict[str, Any]) -> dict[str, Any]:
    """疑点 → 取证单快照（标题/描述取富文本 text 字段）。"""
    title = finding.get("title")
    description = finding.get("description")
    return {
        "id": str(finding.get("id") or ""),
        "title": (title.get("text") if isinstance(title, dict) else title)
        or finding.get("ruleKey")
        or str(finding.get("id") or ""),
        "description": description.get("text") if isinstance(description, dict) else "",
        "severity": str(finding.get("severity") or ""),
        "status": str(finding.get("status") or ""),
        "subjects": list(finding.get("subjects") or []),
        "amount": finding.get("amount"),
        "currency": str(finding.get("currency") or "CNY"),
        "evidence": [str(ref) for ref in (finding.get("evidenceRefs") or [])],
    }


# ---- 编号 / manifest ----


def next_form_id(root: Path) -> str:
    """分配下一个 QZ 编号；计数器丢失时顺延到第一个空位。"""
    root = Path(root)
    while True:
        seq = next_counter(root / ".fireeye", "evidenceForm", root)
        form_id = f"QZ-{seq:04d}"
        if not (forms_dir(root) / form_id).exists():
            return form_id


def load_manifest(root: Path, form_id: str) -> dict[str, Any]:
    root = Path(root)
    if not _FORM_ID.fullmatch(form_id or ""):
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": form_id})
    path = _manifest_path(root, form_id)
    if not path.is_file():
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": form_id})
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError) as exc:
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": form_id}) from exc


def save_manifest(root: Path, manifest: dict[str, Any]) -> None:
    root = Path(root)
    path = _manifest_path(root, str(manifest["id"]))
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(path, manifest)


def get_evidence_form(root: Path, form_id: str) -> dict[str, Any]:
    return load_manifest(root, form_id)


def list_evidence_forms(root: Path) -> list[dict[str, Any]]:
    root = Path(root)
    base = forms_dir(root)
    if not base.is_dir():
        return []
    items: list[dict[str, Any]] = []
    for entry in base.iterdir():
        path = entry / "manifest.json"
        if not path.is_file():
            continue
        try:
            manifest = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        if manifest.get("kind") == KIND:
            items.append(manifest)
    items.sort(
        key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""),
        reverse=True,
    )
    return items


def delete_evidence_form(root: Path, form_id: str) -> None:
    root = Path(root)
    manifest = load_manifest(root, form_id)
    receipt = manifest.get("receipt") or {}
    rel = receipt.get("path") if isinstance(receipt, dict) else None
    if rel:
        try:
            (root / rel).unlink(missing_ok=True)
        except OSError:
            pass
    with WORKSPACE_MUTATION_LOCK:
        shutil.rmtree(forms_dir(root) / form_id, ignore_errors=True)


# ---- 回执单 ----


def _receipt_path(root: Path, form_id: str, name: str) -> Path:
    return receipts_dir(root) / f"{form_id}_{Path(name).name}"


def attach_receipt(
    root: Path, form_id: str, source: Path, note: str | None = None
) -> dict[str, Any]:
    root = Path(root)
    manifest = load_manifest(root, form_id)
    source = Path(source)
    if not source.is_file():
        raise ApiError(
            "E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"name": source.name}
        )
    if source.suffix.lower() not in RECEIPT_EXT:
        raise ApiError("E_FILE_TYPE", 400, "error.fileType", {"name": source.name})
    if source.stat().st_size > RECEIPT_MAX:
        raise ApiError(
            "E_FILE_TOO_LARGE", 400, "error.fileTooLarge", {"name": source.name}
        )

    with WORKSPACE_MUTATION_LOCK:
        old = manifest.get("receipt") or {}
        if isinstance(old, dict) and old.get("path"):
            try:
                (root / old["path"]).unlink(missing_ok=True)
            except OSError:
                pass
        target = _receipt_path(root, form_id, source.name)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        except OSError as exc:
            raise ApiError("E_FILE_WRITE", 500, "error.opFailed") from exc
        manifest["receipt"] = {
            "path": _posix(target, root),
            "name": source.name,
            "uploadedAt": now_iso(),
            "note": (note or "").strip() or None,
        }
        save_manifest(root, manifest)
    return manifest


def clear_receipt(root: Path, form_id: str) -> dict[str, Any]:
    root = Path(root)
    manifest = load_manifest(root, form_id)
    with WORKSPACE_MUTATION_LOCK:
        receipt = manifest.get("receipt") or {}
        if isinstance(receipt, dict) and receipt.get("path"):
            try:
                (root / receipt["path"]).unlink(missing_ok=True)
            except OSError:
                pass
        manifest["receipt"] = None
        save_manifest(root, manifest)
    return manifest