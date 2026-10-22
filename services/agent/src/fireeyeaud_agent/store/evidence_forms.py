"""取证单：从模板渲染预览，保存为带快照的产物，并管理回执单。

产物目录（每个取证单）::

    .fireeye/artifacts/evidence-forms/QZ-0001/
    ├─ document.docx     # 渲染结果
    ├─ template.docx     # 生成时使用的原始模板快照
    └─ manifest.json

预览先渲染到 ``.fireeye/staging/<token>/``，点保存才分配编号并复制进产物目录。
"""

from __future__ import annotations

import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..util import now_iso
from . import evidence as evidence_store
from . import findings as findings_store
from . import templates as templates_store
from .docx_render import prepare_template, render_docx
from .fsutil import write_json_atomic
from .lock import WORKSPACE_MUTATION_LOCK
from .project import next_counter

KIND = "evidence-form"
ARTIFACT_DIR = "evidence-forms"
STAGING_TTL = timedelta(hours=24)

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


# ---- 快照与上下文 ----


def _finding_snapshot(
    finding: dict[str, Any], evidence_by_id: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    title = finding.get("title")
    description = finding.get("description")
    return {
        "id": str(finding.get("id") or ""),
        "title": (title or {}).get("text") if isinstance(title, dict) else None
        or finding.get("ruleKey")
        or str(finding.get("id") or ""),
        "description": (description or {}).get("text")
        if isinstance(description, dict)
        else "",
        "severity": str(finding.get("severity") or ""),
        "status": str(finding.get("status") or ""),
        "subjects": list(finding.get("subjects") or []),
        "amount": finding.get("amount"),
        "currency": str(finding.get("currency") or "CNY"),
        "evidence": [
            str(e.get("title") or e.get("resultSummary") or e.get("filePath") or e.get("id"))
            for e in (
                evidence_by_id.get(ref) for ref in (finding.get("evidenceRefs") or [])
            )
            if e
        ],
    }


def _today() -> str:
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")


def build_form_context(
    header: dict[str, str], snapshots: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "项目名称": header.get("projectName") or "",
        "项目编号": header.get("projectCode") or "",
        "被审计单位": header.get("auditee") or "",
        "审计期间": header.get("period") or "",
        "编制人": header.get("preparedBy") or "",
        "复核人": header.get("reviewedBy") or "",
        "日期": header.get("date") or _today(),
        "取证单编号": header.get("formNo") or "（保存时生成）",
        "取证单标题": header.get("formTitle") or "",
        "疑点数量": len(snapshots),
        "findings": [
            {
                "编号": s["id"],
                "标题": s["title"],
                "描述": s["description"],
                "风险": SEVERITY_LABEL.get(s["severity"], s["severity"]),
                "状态": STATUS_LABEL.get(s["status"], s["status"]),
                "科目": "、".join(s["subjects"]),
                "金额": f'{s["amount"]} {s["currency"]}' if s["amount"] else "",
                "证据": "；".join(s["evidence"]),
                "证据数量": len(s["evidence"]),
            }
            for s in snapshots
        ],
    }


# ---- 暂存 ----


def _cleanup_staging(root: Path) -> None:
    base = staging_dir(root)
    if not base.is_dir():
        return
    cutoff = datetime.now(timezone.utc) - STAGING_TTL
    for entry in base.iterdir():
        if not entry.is_dir():
            continue
        try:
            mtime = datetime.fromtimestamp(entry.stat().st_mtime, tz=timezone.utc)
        except OSError:
            continue
        if mtime < cutoff:
            shutil.rmtree(entry, ignore_errors=True)


def _load_payload(root: Path, token: str, kind: str) -> tuple[Path, dict[str, Any]]:
    if not token or "/" in token or "\\" in token or token in (".", ".."):
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound")
    directory = staging_dir(root) / token
    payload_path = directory / "payload.json"
    if not payload_path.is_file():
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound")
    try:
        import json

        payload = json.loads(payload_path.read_text("utf-8"))
    except (OSError, ValueError) as exc:
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound") from exc
    if payload.get("kind") != kind:
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound")
    try:
        created = datetime.fromisoformat(str(payload.get("createdAt")))
    except (TypeError, ValueError) as exc:
        raise ApiError("E_STAGING_EXPIRED", 410, "error.stagingExpired") from exc
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - created > STAGING_TTL:
        raise ApiError("E_STAGING_EXPIRED", 410, "error.stagingExpired")
    return directory, payload


# ---- 预览 ----


def preview_evidence_form(
    root: Path,
    *,
    template_id: str,
    template_scope: str | None,
    finding_ids: list[str],
    header: dict[str, str],
) -> dict[str, Any]:
    root = Path(root)
    if not finding_ids:
        raise ApiError("E_FINDINGS_REQUIRED", 400, "error.findingsRequired")

    template = templates_store.resolve_template(root, template_id, template_scope)
    if template.get("kind") != KIND:
        raise ApiError(
            "E_TEMPLATE_KIND", 400, "error.templateKindMismatch", {"kind": KIND}
        )
    source = templates_store.template_path(root, template_id, str(template["scope"]))
    if source is None:
        raise ApiError(
            "E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"name": template_id}
        )

    findings: list[dict[str, Any]] = []
    for finding_id in finding_ids:
        finding = findings_store.get_finding(root, finding_id)
        if finding is None:
            raise ApiError(
                "E_FINDINGS_REQUIRED", 400, "error.findingsRequired", {"id": finding_id}
            )
        findings.append(finding)

    evidence_by_id = {str(e.get("id")): e for e in evidence_store.load_evidence(root)}
    snapshots = [_finding_snapshot(f, evidence_by_id) for f in findings]

    warnings: list[str] = []
    check = template.get("check") or {}
    if isinstance(check, dict):
        for field in check.get("unknown") or []:
            warnings.append(f"模板包含未识别字段：{field}")
        for field in check.get("missing") or []:
            warnings.append(f"模板缺少关键字段：{field}")
        for field in check.get("unclosed") or []:
            warnings.append(f"模板循环未闭合：{field}")
    if any(not s["evidence"] for s in snapshots):
        warnings.append("部分疑点没有关联证据")

    _cleanup_staging(root)
    token = uuid.uuid4().hex
    directory = staging_dir(root) / token
    directory.mkdir(parents=True, exist_ok=True)

    original = directory / "template.docx"
    prepared = directory / "prepared.docx"
    document = directory / "document.docx"
    try:
        shutil.copyfile(source, original)
        prepare_template(original, prepared, KIND)
        render_docx(prepared, document, build_form_context(header, snapshots))
    except ApiError:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    except OSError as exc:
        shutil.rmtree(directory, ignore_errors=True)
        raise ApiError("E_FILE_WRITE", 500, "error.opFailed") from exc

    payload = {
        "kind": KIND,
        "templateId": template_id,
        "templateScope": str(template["scope"]),
        "templateName": str(template.get("name") or ""),
        "header": dict(header or {}),
        "findingIds": [str(f["id"]) for f in findings],
        "findingsSnapshot": snapshots,
        "evidenceIds": sorted(
            {
                str(ref)
                for f in findings
                for ref in (f.get("evidenceRefs") or [])
            }
        ),
        "suggestedTitle": (header or {}).get("formTitle")
        or ((header or {}).get("projectName") and f"取证单 · {header['projectName']}")
        or "取证单",
        "createdAt": now_iso(),
    }
    write_json_atomic(directory / "payload.json", payload)

    return {
        "token": token,
        "kind": KIND,
        "fileName": f"{payload['suggestedTitle']}.docx",
        "relPath": _posix(document, root),
        "suggestedTitle": payload["suggestedTitle"],
        "warnings": warnings,
    }


# ---- 保存 / 列表 / 删除 ----


def commit_evidence_form(root: Path, token: str, title: str | None = None) -> dict[str, Any]:
    root = Path(root)
    with WORKSPACE_MUTATION_LOCK:
        directory, payload = _load_payload(root, token, KIND)
        # 计数器可能被重建（project.json 丢失）；绝不覆盖已存在的产物，顺延到空位。
        while True:
            seq = next_counter(root / ".fireeye", "evidenceForm", root)
            form_id = f"QZ-{seq:04d}"
            target = forms_dir(root) / form_id
            if not target.exists():
                break
        target.mkdir(parents=True, exist_ok=True)

        try:
            shutil.copyfile(directory / "document.docx", target / "document.docx")
            shutil.copyfile(directory / "template.docx", target / "template.docx")
        except OSError as exc:
            shutil.rmtree(target, ignore_errors=True)
            raise ApiError("E_FILE_WRITE", 500, "error.opFailed") from exc

        manifest = {
            "id": form_id,
            "kind": KIND,
            "title": (title or payload.get("suggestedTitle") or form_id).strip(),
            "templateId": payload.get("templateId"),
            "templateScope": payload.get("templateScope"),
            "templateName": payload.get("templateName") or "",
            "createdAt": now_iso(),
            "createdBy": payload.get("header", {}).get("preparedBy") or "",
            "header": payload.get("header") or {},
            "findingIds": payload.get("findingIds") or [],
            "findingsSnapshot": payload.get("findingsSnapshot") or [],
            "evidenceIds": payload.get("evidenceIds") or [],
            "receipt": None,
            "artifactRef": _posix(target, root),
            "files": ["document.docx", "template.docx"],
        }
        write_json_atomic(target / "manifest.json", manifest)
        shutil.rmtree(directory, ignore_errors=True)
        return manifest


def _manifest_path(root: Path, form_id: str) -> Path:
    return forms_dir(root) / form_id / "manifest.json"


def get_evidence_form(root: Path, form_id: str) -> dict[str, Any]:
    import json
    import re

    if not re.fullmatch(r"QZ-\d{4,}", form_id):
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": form_id})
    path = _manifest_path(Path(root), form_id)
    if not path.is_file():
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": form_id})
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError) as exc:
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": form_id}) from exc


def list_evidence_forms(root: Path) -> list[dict[str, Any]]:
    import json

    base = forms_dir(Path(root))
    if not base.is_dir():
        return []
    items: list[dict[str, Any]] = []
    for entry in base.iterdir():
        manifest_path = entry / "manifest.json"
        if not manifest_path.is_file():
            continue
        try:
            manifest = json.loads(manifest_path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        if manifest.get("kind") == KIND:
            items.append(manifest)
    items.sort(key=lambda i: str(i.get("createdAt") or ""), reverse=True)
    return items


def delete_evidence_form(root: Path, form_id: str) -> None:
    root = Path(root)
    manifest = get_evidence_form(root, form_id)
    receipt = manifest.get("receipt") or {}
    rel = receipt.get("path") if isinstance(receipt, dict) else None
    if rel:
        try:
            (root / rel).unlink(missing_ok=True)
        except OSError:
            pass
    shutil.rmtree(forms_dir(root) / form_id, ignore_errors=True)


# ---- 回执单 ----


def _receipt_path(root: Path, form_id: str, name: str) -> Path:
    return receipts_dir(root) / f"{form_id}_{Path(name).name}"


def _save_manifest(root: Path, manifest: dict[str, Any]) -> None:
    write_json_atomic(_manifest_path(root, str(manifest["id"])), manifest)


def attach_receipt(root: Path, form_id: str, source: Path) -> dict[str, Any]:
    root = Path(root)
    manifest = get_evidence_form(root, form_id)
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
        }
        _save_manifest(root, manifest)
    return manifest


def clear_receipt(root: Path, form_id: str) -> dict[str, Any]:
    root = Path(root)
    manifest = get_evidence_form(root, form_id)
    with WORKSPACE_MUTATION_LOCK:
        receipt = manifest.get("receipt") or {}
        if isinstance(receipt, dict) and receipt.get("path"):
            try:
                (root / receipt["path"]).unlink(missing_ok=True)
            except OSError:
                pass
        manifest["receipt"] = None
        _save_manifest(root, manifest)
    return manifest