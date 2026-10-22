"""项目报告：把选中的取证单按顺序渲染成一份报告，并保存生成时快照。

产物目录::

    .fireeye/artifacts/reports/RPT-0001/
    ├─ document.docx
    ├─ template.docx
    └─ manifest.json

报告只读取取证单 **manifest 快照**，不读实时疑点：取证单删除后报告仍可追溯。
"""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..util import now_iso
from . import evidence_forms
from . import templates as templates_store
from .docx_render import prepare_template, render_docx
from .fsutil import write_json_atomic
from .lock import WORKSPACE_MUTATION_LOCK
from .project import next_counter

KIND = "report"
ARTIFACT_DIR = "reports"


def reports_dir(root: Path) -> Path:
    return evidence_forms.artifacts_root(root) / ARTIFACT_DIR


def _posix(path: Path, root: Path) -> str:
    return path.relative_to(Path(root)).as_posix()


def _summary(findings: list[dict[str, Any]], limit: int = 3) -> str:
    """疑点摘要：前 N 条标题，超出加「等 N 条」。"""
    titles = [str(f.get("title") or f.get("id") or "") for f in findings]
    shown = "；".join(t for t in titles[:limit] if t)
    if len(titles) > limit:
        return f"{shown} 等 {len(titles)} 条"
    return shown


def build_report_context(
    header: dict[str, str],
    forms: list[dict[str, Any]],
    findings: list[dict[str, Any]],
) -> dict[str, Any]:
    context_findings = [
        {
            "编号": str(f.get("id") or ""),
            "标题": str(f.get("title") or ""),
            "描述": str(f.get("description") or ""),
            "风险": evidence_forms.SEVERITY_LABEL.get(
                str(f.get("severity") or ""), str(f.get("severity") or "")
            ),
            "状态": evidence_forms.STATUS_LABEL.get(
                str(f.get("status") or ""), str(f.get("status") or "")
            ),
            "科目": "、".join(f.get("subjects") or []),
            "金额": f'{f["amount"]} {f.get("currency") or "CNY"}'
            if f.get("amount")
            else "",
            "证据": "；".join(f.get("evidence") or []),
            "证据数量": len(f.get("evidence") or []),
        }
        for f in findings
    ]
    return {
        "项目名称": header.get("projectName") or "",
        "项目编号": header.get("projectCode") or "",
        "被审计单位": header.get("auditee") or "",
        "审计期间": header.get("period") or "",
        "编制人": header.get("preparedBy") or "",
        "复核人": header.get("reviewedBy") or "",
        "日期": header.get("date") or evidence_forms._today(),
        "报告编号": header.get("reportNo") or "（保存时生成）",
        "报告标题": header.get("reportTitle") or "",
        "取证单数量": len(forms),
        "疑点数量": len(findings),
        "forms": [
            {
                "编号": str(f.get("id") or ""),
                "标题": str(f.get("title") or ""),
                "日期": str(f.get("createdAt") or "")[:10],
                "疑点数量": int(f.get("findingCount") or 0),
                "回执": (f.get("receipt") or {}).get("name") if f.get("receipt") else "",
                "疑点摘要": _summary(
                    list(f.get("findings") or f.get("findingsSnapshot") or [])
                ),
                "编制人": str((f.get("header") or {}).get("preparedBy") or ""),
            }
            for f in forms
        ],
        "findings": context_findings,
    }


def preview_report(
    root: Path,
    *,
    template_id: str,
    template_scope: str | None,
    form_ids: list[str],
    header: dict[str, str],
) -> dict[str, Any]:
    root = Path(root)
    if not form_ids:
        raise ApiError("E_FORMS_REQUIRED", 400, "error.formsRequired")

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

    forms: list[dict[str, Any]] = []
    for form_id in form_ids:
        try:
            forms.append(evidence_forms.get_evidence_form(root, form_id))
        except ApiError as exc:
            raise ApiError(
                "E_FORMS_REQUIRED", 400, "error.formsRequired", {"id": form_id}
            ) from exc

    # 展平所有取证单快照里的疑点，按 id 去重（保持首次出现顺序）
    findings: list[dict[str, Any]] = []
    seen: set[str] = set()
    for form in forms:
        for finding in form.get("findingsSnapshot") or []:
            fid = str(finding.get("id") or "")
            if fid and fid not in seen:
                seen.add(fid)
                findings.append(finding)

    warnings: list[str] = []
    check = template.get("check") or {}
    if isinstance(check, dict):
        for field in check.get("unknown") or []:
            warnings.append(f"模板包含未识别字段：{field}")
        for field in check.get("missing") or []:
            warnings.append(f"模板缺少关键字段：{field}")
        for field in check.get("unclosed") or []:
            warnings.append(f"模板循环未闭合：{field}")

    evidence_forms._cleanup_staging(root)
    token = uuid.uuid4().hex
    directory = evidence_forms.staging_dir(root) / token
    directory.mkdir(parents=True, exist_ok=True)

    original = directory / "template.docx"
    prepared = directory / "prepared.docx"
    document = directory / "document.docx"
    try:
        shutil.copyfile(source, original)
        prepare_template(original, prepared, KIND)
        render_docx(prepared, document, build_report_context(header, forms, findings))
    except ApiError:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    except OSError as exc:
        shutil.rmtree(directory, ignore_errors=True)
        raise ApiError("E_FILE_WRITE", 500, "error.opFailed") from exc

    suggested = (header or {}).get("reportTitle") or (
        ((header or {}).get("projectName") and f"项目报告 · {header['projectName']}")
        or "项目报告"
    )
    payload = {
        "kind": KIND,
        "templateId": template_id,
        "templateScope": str(template["scope"]),
        "templateName": str(template.get("name") or ""),
        "header": dict(header or {}),
        "formIds": [str(f["id"]) for f in forms],
        "forms": forms,
        "findingCount": len(findings),
        "suggestedTitle": suggested,
        "createdAt": now_iso(),
    }
    write_json_atomic(directory / "payload.json", payload)

    return {
        "token": token,
        "kind": KIND,
        "fileName": f"{suggested}.docx",
        "relPath": _posix(document, root),
        "suggestedTitle": suggested,
        "warnings": warnings,
    }


def commit_report(root: Path, token: str, title: str | None = None) -> dict[str, Any]:
    root = Path(root)
    with WORKSPACE_MUTATION_LOCK:
        directory, payload = evidence_forms._load_payload(root, token, KIND)
        # 计数器可能被重建；绝不覆盖已存在的报告目录，顺延到空位。
        while True:
            seq = next_counter(root / ".fireeye", "report", root)
            report_id = f"RPT-{seq:04d}"
            target = reports_dir(root) / report_id
            if not target.exists():
                break
        target.mkdir(parents=True, exist_ok=True)

        try:
            shutil.copyfile(directory / "document.docx", target / "document.docx")
            shutil.copyfile(directory / "template.docx", target / "template.docx")
        except OSError as exc:
            shutil.rmtree(target, ignore_errors=True)
            raise ApiError("E_FILE_WRITE", 500, "error.opFailed") from exc

        forms_snapshot = [
            {
                "id": form.get("id"),
                "title": form.get("title"),
                "createdAt": form.get("createdAt"),
                "findingCount": len(form.get("findingsSnapshot") or []),
                "receipt": form.get("receipt"),
                "findings": form.get("findingsSnapshot") or [],
                "header": form.get("header") or {},
            }
            for form in payload.get("forms") or []
        ]
        manifest = {
            "id": report_id,
            "kind": KIND,
            "title": (title or payload.get("suggestedTitle") or report_id).strip(),
            "templateId": payload.get("templateId"),
            "templateScope": payload.get("templateScope"),
            "templateName": payload.get("templateName") or "",
            "createdAt": now_iso(),
            "createdBy": payload.get("header", {}).get("preparedBy") or "",
            "header": payload.get("header") or {},
            "formIds": payload.get("formIds") or [],
            "formsSnapshot": forms_snapshot,
            "findingCount": int(payload.get("findingCount") or 0),
            "artifactRef": _posix(target, root),
            "files": ["document.docx", "template.docx"],
        }
        write_json_atomic(target / "manifest.json", manifest)
        shutil.rmtree(directory, ignore_errors=True)
        return manifest


def _manifest_path(root: Path, report_id: str) -> Path:
    return reports_dir(root) / report_id / "manifest.json"


def get_report(root: Path, report_id: str) -> dict[str, Any]:
    import re

    if not re.fullmatch(r"RPT-\d{4,}", report_id):
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": report_id})
    path = _manifest_path(Path(root), report_id)
    if not path.is_file():
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": report_id})
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError) as exc:
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": report_id}) from exc


def list_reports(root: Path) -> list[dict[str, Any]]:
    base = reports_dir(Path(root))
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


def delete_report(root: Path, report_id: str) -> None:
    root = Path(root)
    get_report(root, report_id)
    shutil.rmtree(reports_dir(root) / report_id, ignore_errors=True)