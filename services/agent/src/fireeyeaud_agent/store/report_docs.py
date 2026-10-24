"""报告草稿：结构化正文（body.json）、章节写入、按模板样式导出 docx。

正文是唯一事实来源；document.docx 只在导出时生成。
导出以模板文件为底（保留 styles.xml / 页眉页脚 / 节设置），清空正文后按骨架样式写入。
"""

from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path
from typing import Any

from docx import Document

from ..errors import ApiError
from ..util import now_iso
from . import docx_blocks
from . import evidence_forms
from . import reports as reports_store
from . import templates as templates_store
from .fsutil import write_json_atomic
from .lock import WORKSPACE_MUTATION_LOCK
from .project import load_project, next_counter
from .report_skeleton import analyze_template

KIND = "report"
_STATUS_DRAFT = "draft"
_STATUS_SAVED = "saved"
_REPORT_ID = re.compile(r"RPT-\d{4,}")
_DEFAULT_OUTLINE = [
    {"title": "一、基本情况", "level": 1, "goal": "说明审计依据、范围与实施情况"},
    {"title": "二、审计发现", "level": 1, "goal": "按取证单逐项说明问题、事实依据与金额"},
    {"title": "三、审计结论与建议", "level": 1, "goal": "给出结论与整改建议"},
]


# ---- 基础 ----


def _dir(root: Path, report_id: str) -> Path:
    return reports_store.reports_dir(Path(root)) / report_id


def _validate_id(report_id: str) -> None:
    if not _REPORT_ID.fullmatch(report_id or ""):
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": report_id})


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _load_manifest(root: Path, report_id: str) -> dict[str, Any]:
    _validate_id(report_id)
    manifest = _read_json(_dir(root, report_id) / "manifest.json")
    if manifest is None or manifest.get("kind") != KIND:
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": report_id})
    return manifest


def _load_body(root: Path, report_id: str) -> dict[str, Any]:
    body = _read_json(_dir(root, report_id) / "body.json")
    if body is None:
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": report_id})
    return body


def _load_skeleton(root: Path, report_id: str) -> dict[str, Any]:
    return _read_json(_dir(root, report_id) / "skeleton.json") or {}


def _save_manifest(root: Path, report_id: str, manifest: dict[str, Any]) -> None:
    manifest["updatedAt"] = now_iso()
    write_json_atomic(_dir(root, report_id) / "manifest.json", manifest)


def _save_body(root: Path, report_id: str, body: dict[str, Any]) -> None:
    body["updatedAt"] = now_iso()
    write_json_atomic(_dir(root, report_id) / "body.json", body)


def _form_snapshot(form: dict[str, Any]) -> dict[str, Any]:
    findings = list(form.get("findingsSnapshot") or [])
    return {
        "id": form.get("id"),
        "title": form.get("title"),
        "createdAt": form.get("createdAt"),
        "header": form.get("header") or {},
        "receipt": form.get("receipt"),
        "findings": findings,
        "findingCount": len(findings),
    }


# ---- 创建 / 读取 ----


def create_report(
    root: Path,
    *,
    template_id: str,
    template_scope: str,
    form_ids: list[str],
    header: dict[str, str] | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    root = Path(root)
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
    for form_id in dict.fromkeys(form_ids or []):
        forms.append(evidence_forms.get_evidence_form(root, form_id))

    skeleton = analyze_template(source)
    project = load_project(root / ".fireeye") or {}
    header = dict(header or {})
    project_name = str(project.get("name") or "")
    header.setdefault("projectName", project_name)
    header.setdefault("date", now_iso()[:10])
    report_title = (
        (title or "").strip()
        or str(header.get("reportTitle") or "").strip()
        or (f"{project_name}审计报告" if project_name else "项目报告")
    )[:200]

    skeleton_sections = skeleton.get("sections") or []
    raw_outline = (
        [
            {"title": str(item.get("title") or ""), "level": int(item.get("level") or 1)}
            for item in skeleton_sections
        ]
        if skeleton_sections
        else [dict(item) for item in _DEFAULT_OUTLINE]
    )
    outline = docx_blocks.normalize_outline(raw_outline, existing=[])
    for item in outline:
        item["goal"] = item.get("goal") or ""

    with WORKSPACE_MUTATION_LOCK:
        while True:
            seq = next_counter(root / ".fireeye", "report", root)
            report_id = f"RPT-{seq:04d}"
            if not _dir(root, report_id).exists():
                break
        directory = _dir(root, report_id)
        directory.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copyfile(source, directory / "template.docx")
            write_json_atomic(directory / "skeleton.json", skeleton)
        except OSError as exc:
            shutil.rmtree(directory, ignore_errors=True)
            raise ApiError("E_FILE_WRITE", 500, "error.opFailed") from exc

        body = {
            "schemaVersion": 1,
            "reportId": report_id,
            "title": report_title,
            "outlineApproved": False,
            "selectedFormIds": [str(form["id"]) for form in forms],
            "sections": outline,
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
        }
        manifest = {
            "id": report_id,
            "kind": KIND,
            "status": _STATUS_DRAFT,
            "title": report_title,
            "templateId": template_id,
            "templateScope": str(template["scope"]),
            "templateName": str(template.get("name") or ""),
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
            "createdBy": str(header.get("preparedBy") or ""),
            "header": header,
            "formIds": [str(form["id"]) for form in forms],
            "formsSnapshot": [_form_snapshot(form) for form in forms],
            "findingCount": sum(
                len(form.get("findingsSnapshot") or []) for form in forms
            ),
            "artifactRef": f"{reports_store.reports_dir(root).relative_to(root).as_posix()}/{report_id}"
            if _is_relative(reports_store.reports_dir(root), root)
            else f".fireeye/artifacts/reports/{report_id}",
            "files": ["manifest.json", "body.json", "skeleton.json", "template.docx"],
        }
        write_json_atomic(directory / "body.json", body)
        write_json_atomic(directory / "manifest.json", manifest)

    return {"manifest": manifest, "body": body, "skeleton": skeleton}


def _is_relative(path: Path, root: Path) -> bool:
    try:
        Path(path).resolve().relative_to(Path(root).resolve())
    except (OSError, ValueError):
        return False
    return True


def get_document(root: Path, report_id: str) -> dict[str, Any]:
    root = Path(root)
    manifest = _load_manifest(root, report_id)
    body = _load_body(root, report_id)
    skeleton = _load_skeleton(root, report_id)
    return {"manifest": manifest, "body": body, "skeleton": skeleton}


def set_forms(root: Path, report_id: str, form_ids: list[str]) -> dict[str, Any]:
    """更新报告本轮提交给模型的取证单范围，并刷新 manifest 快照。"""
    root = Path(root)
    ids = list(dict.fromkeys(str(item) for item in form_ids if str(item).strip()))
    forms = [evidence_forms.get_evidence_form(root, form_id) for form_id in ids]

    with WORKSPACE_MUTATION_LOCK:
        body = _load_body(root, report_id)
        manifest = _load_manifest(root, report_id)
        current = [str(item) for item in body.get("selectedFormIds") or []]
        if current == ids and [str(item) for item in manifest.get("formIds") or []] == ids:
            return body

        snapshots = [_form_snapshot(form) for form in forms]
        body["selectedFormIds"] = ids
        manifest["formIds"] = ids
        manifest["formsSnapshot"] = snapshots
        manifest["findingCount"] = sum(
            int(item.get("findingCount") or 0) for item in snapshots
        )
        _mark_draft(manifest)
        _save_body(root, report_id, body)
        _save_manifest(root, report_id, manifest)
    return body


# ---- 大纲 / 章节 ----


def _mark_draft(manifest: dict[str, Any]) -> None:
    """正文一改，已导出的 docx 就过期了。"""
    if manifest.get("status") == _STATUS_SAVED:
        manifest["status"] = _STATUS_DRAFT


def set_outline(
    root: Path,
    report_id: str,
    sections: list[dict[str, Any]],
    *,
    approved: bool,
) -> dict[str, Any]:
    root = Path(root)
    with WORKSPACE_MUTATION_LOCK:
        body = _load_body(root, report_id)
        outline = docx_blocks.normalize_outline(sections, existing=list(body.get("sections") or []))
        if not outline:
            raise ApiError("E_OUTLINE_EMPTY", 400, "error.outlineEmpty")
        body["sections"] = outline
        body["outlineApproved"] = bool(approved)
        _save_body(root, report_id, body)
        manifest = _load_manifest(root, report_id)
        _mark_draft(manifest)
        _save_manifest(root, report_id, manifest)
    return body


def write_section(
    root: Path,
    report_id: str,
    section_id: str,
    blocks: list[dict[str, Any]],
) -> dict[str, Any]:
    root = Path(root)
    with WORKSPACE_MUTATION_LOCK:
        body = _load_body(root, report_id)
        sections = list(body.get("sections") or [])
        target = next((s for s in sections if str(s.get("id")) == section_id), None)
        if target is None:
            raise ApiError(
                "E_SECTION_NOT_FOUND", 404, "error.sectionNotFound", {"id": section_id}
            )
        target["blocks"] = docx_blocks.normalize_blocks(blocks)
        target["status"] = "written" if target["blocks"] else "empty"
        _save_body(root, report_id, body)
        manifest = _load_manifest(root, report_id)
        _mark_draft(manifest)
        _save_manifest(root, report_id, manifest)
    return target


def set_title(root: Path, report_id: str, title: str) -> dict[str, Any]:
    root = Path(root)
    name = (title or "").strip()[:200]
    if not name:
        raise ApiError("E_INVALID_TITLE", 400, "error.outlineEmpty")
    with WORKSPACE_MUTATION_LOCK:
        body = _load_body(root, report_id)
        body["title"] = name
        _save_body(root, report_id, body)
        manifest = _load_manifest(root, report_id)
        manifest["title"] = name
        _mark_draft(manifest)
        _save_manifest(root, report_id, manifest)
    return body


# ---- 导出 ----


def export_report(root: Path, report_id: str, *, title: str | None = None) -> dict[str, Any]:
    root = Path(root)
    from .report_verify import verify_report

    with WORKSPACE_MUTATION_LOCK:
        # 校验与写入同一把锁：避免校验通过后又插入未校验内容
        check = verify_report(root, report_id)
        if not check["ok"]:
            raise ApiError(
                "E_VERIFY_FAILED",
                409,
                "error.reportVerifyFailed",
                {"count": len(check["errors"])},
            )

        directory = _dir(root, report_id)
        manifest = _load_manifest(root, report_id)
        body = _load_body(root, report_id)
        skeleton = _load_skeleton(root, report_id)
        template_path = directory / "template.docx"
        if not template_path.is_file():
            raise ApiError("E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"name": "template.docx"})

        try:
            document = Document(str(template_path))
        except Exception as exc:  # noqa: BLE001
            raise ApiError("E_FILE_TYPE", 400, "error.fileType", {"name": "template.docx"}) from exc

        final_title = (title or body.get("title") or manifest.get("title") or report_id).strip()[:200]
        keep_until = {
            str((skeleton.get("title") or {}).get("text") or "").strip(),
            str(manifest.get("title") or "").strip(),
            str(body.get("title") or "").strip(),
            final_title,
        } - {""}
        lost = docx_blocks.clear_body(document, keep_until)

        expected = {
            *keep_until,
            final_title,
            *[str(item.get("title") or "") for item in skeleton.get("sections") or []],
            *[
                str(text)
                for item in skeleton.get("sections") or []
                for text in item.get("sampleText") or []
            ],
            *[str(text) for text in skeleton.get("preamble") or []],
        }
        unexpected = [text for text in lost if text not in expected]
        export_warnings: list[str] = []
        if unexpected:
            sample = "、".join(dict.fromkeys(unexpected))[:120]
            export_warnings.append(
                f"模板中标题之后的固定内容不会保留：{sample}"
            )

        body_style = dict(skeleton.get("body") or {})
        title_style = dict((skeleton.get("title") or {}).get("style") or {})
        if not title_style:
            title_style = {
                **body_style,
                "bold": True,
                "size": float(body_style.get("size") or 16) + 6,
                "align": "center",
                "firstLineIndent": 0,
            }
        title_style["align"] = "center"
        title_style["firstLineIndent"] = 0

        docx_blocks.add_text(document, final_title, title_style)

        for section in body.get("sections") or []:
            level = int(section.get("level") or 1)
            docx_blocks.add_text(document, str(section.get("title") or ""), docx_blocks.heading_style(skeleton, level))
            for block in section.get("blocks") or []:
                kind = block.get("type")
                if kind == "paragraph":
                    docx_blocks.add_text(
                        document,
                        str(block.get("text") or ""),
                        body_style,
                        runs=block.get("runs"),
                        align=block.get("align"),
                    )
                elif kind == "bullets":
                    item_runs = block.get("itemRuns") or []
                    item_align = block.get("itemAlign") or []
                    for index, item in enumerate(block.get("items") or []):
                        docx_blocks.add_text(
                            document,
                            str(item),
                            body_style,
                            bullet=True,
                            runs=item_runs[index] if index < len(item_runs) else None,
                            align=item_align[index] if index < len(item_align) else None,
                        )
                elif kind == "table":
                    columns = [str(c) for c in block.get("columns") or []]
                    if not columns:
                        continue
                    rows = [list(map(str, row)) for row in block.get("rows") or []]
                    column_runs = block.get("columnRuns") or []
                    row_runs = block.get("rowRuns") or []
                    column_align = block.get("columnAlign") or []
                    row_align = block.get("rowAlign") or []
                    table_meta = (skeleton.get("tables") or [{}])[0]
                    cell_style = dict(table_meta.get("cellStyle") or body_style)
                    table = document.add_table(rows=1 + len(rows), cols=len(columns))
                    style_name = str(table_meta.get("styleName") or "")
                    if style_name:
                        try:
                            table.style = document.styles[style_name]
                        except KeyError:
                            pass
                    for index, text in enumerate(columns):
                        docx_blocks.write_cell(
                            table.rows[0].cells[index],
                            text,
                            {**cell_style, "bold": True},
                            document,
                            column_runs[index] if index < len(column_runs) else None,
                            column_align[index] if index < len(column_align) else None,
                        )
                    for row_index, row in enumerate(rows, start=1):
                        cells_runs = (
                            row_runs[row_index - 1]
                            if row_index - 1 < len(row_runs)
                            else []
                        )
                        cells_align = (
                            row_align[row_index - 1]
                            if row_index - 1 < len(row_align)
                            else []
                        )
                        for col_index, text in enumerate(row[: len(columns)]):
                            docx_blocks.write_cell(
                                table.rows[row_index].cells[col_index],
                                text,
                                {**cell_style, "bold": False},
                                document,
                                cells_runs[col_index] if col_index < len(cells_runs) else None,
                                cells_align[col_index] if col_index < len(cells_align) else None,
                            )

        tmp_path = directory / "document.tmp.docx"
        try:
            document.save(str(tmp_path))
            os.replace(tmp_path, directory / "document.docx")
        except OSError as exc:
            tmp_path.unlink(missing_ok=True)
            raise ApiError("E_FILE_WRITE", 500, "error.opFailed") from exc

        manifest["title"] = final_title
        manifest["status"] = _STATUS_SAVED
        manifest["exportWarnings"] = export_warnings
        manifest["findingCount"] = sum(
            len(form.get("findings") or [])
            for form in manifest.get("formsSnapshot") or []
        )
        files = set(manifest.get("files") or [])
        files.update(
            ["manifest.json", "body.json", "skeleton.json", "template.docx", "document.docx"]
        )
        manifest["files"] = sorted(files)
        body["title"] = final_title
        _save_body(root, report_id, body)
        _save_manifest(root, report_id, manifest)

    return manifest


# ---- 对话记录 ----


def append_chat(root: Path, report_id: str, entry: dict[str, Any]) -> None:
    root = Path(root)
    directory = _dir(root, report_id)
    if not directory.is_dir():
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": report_id})
    line = json.dumps({"at": now_iso(), **entry}, ensure_ascii=False)
    with WORKSPACE_MUTATION_LOCK:
        with (directory / "chat.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def load_chat(root: Path, report_id: str, limit: int = 40) -> list[dict[str, Any]]:
    _validate_id(report_id)
    path = _dir(Path(root), report_id) / "chat.jsonl"
    if not path.is_file():
        return []
    entries: list[dict[str, Any]] = []
    for line in path.read_text("utf-8").splitlines():
        if not line.strip():
            continue
        try:
            entries.append(json.loads(line))
        except ValueError:
            continue
    return entries[-limit:]
