"""报告草稿：结构化正文（body.json）、章节写入、按模板样式导出 docx。

正文是唯一事实来源；document.docx 只在导出时生成。
导出以模板文件为底（保留 styles.xml / 页眉页脚 / 节设置），清空正文后按骨架样式写入。
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.shared import Pt

from ..errors import ApiError
from ..util import now_iso
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
_MAX_BLOCKS = 60
_MAX_TEXT = 20000
_MAX_TABLE_ROWS = 200

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
    )

    skeleton_sections = skeleton.get("sections") or []
    raw_outline = (
        [
            {"title": str(item.get("title") or ""), "level": int(item.get("level") or 1)}
            for item in skeleton_sections
        ]
        if skeleton_sections
        else [dict(item) for item in _DEFAULT_OUTLINE]
    )
    outline = _normalize_outline(raw_outline, existing=[])
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
            "formsSnapshot": [
                {
                    "id": form.get("id"),
                    "title": form.get("title"),
                    "createdAt": form.get("createdAt"),
                    "header": form.get("header") or {},
                    "receipt": form.get("receipt"),
                    "findings": form.get("findingsSnapshot") or [],
                }
                for form in forms
            ],
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


# ---- 大纲 / 章节 ----


def _normalize_outline(
    sections: list[Any], *, existing: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    by_id = {str(item.get("id")): item for item in existing}
    used: set[str] = set()
    out: list[dict[str, Any]] = []
    for index, raw in enumerate(sections or []):
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or "").strip()
        if not title:
            continue
        try:
            level = int(raw.get("level") or 1)
        except (TypeError, ValueError):
            level = 1
        level = min(max(level, 1), 3)
        section_id = str(raw.get("id") or "")
        if not section_id or section_id in used:
            section_id = f"S{index + 1}"
            while section_id in used:
                section_id = f"S{index + 2}"
        used.add(section_id)
        previous = by_id.get(section_id) or {}
        out.append(
            {
                "id": section_id,
                "title": title,
                "level": level,
                "goal": str(raw.get("goal") or previous.get("goal") or "").strip(),
                "blocks": list(previous.get("blocks") or []),
            }
        )
        if len(out) >= 30:
            break
    return out


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
        outline = _normalize_outline(sections, existing=list(body.get("sections") or []))
        if not outline:
            raise ApiError("E_OUTLINE_EMPTY", 400, "error.outlineEmpty")
        body["sections"] = outline
        body["outlineApproved"] = bool(approved)
        _save_body(root, report_id, body)
        manifest = _load_manifest(root, report_id)
        _save_manifest(root, report_id, manifest)
    return body


def _clean_refs(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    refs = [str(item).strip() for item in value if str(item).strip()]
    return list(dict.fromkeys(refs))[:20]


def _normalize_blocks(blocks: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in (blocks or [])[:_MAX_BLOCKS]:
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("type") or "paragraph")
        refs = _clean_refs(raw.get("sourceRefs"))
        origin = str(raw.get("origin") or "form")
        if origin not in {"form", "user", "model"}:
            origin = "form"
        if kind == "paragraph":
            text = str(raw.get("text") or "").strip()[:_MAX_TEXT]
            if text:
                out.append(
                    {
                        "type": "paragraph",
                        "text": text,
                        "sourceRefs": refs,
                        "origin": origin,
                    }
                )
        elif kind == "bullets":
            items = [
                str(item).strip()[:_MAX_TEXT]
                for item in (raw.get("items") or [])
                if str(item).strip()
            ][:50]
            if items:
                out.append(
                    {
                        "type": "bullets",
                        "items": items,
                        "sourceRefs": refs,
                        "origin": origin,
                    }
                )
        elif kind == "table":
            columns = [str(item).strip() for item in (raw.get("columns") or [])][:12]
            rows: list[list[str]] = []
            for row in (raw.get("rows") or [])[:_MAX_TABLE_ROWS]:
                if not isinstance(row, list):
                    continue
                rows.append([str(cell).strip()[:2000] for cell in row][: len(columns)])
            if columns:
                out.append(
                    {
                        "type": "table",
                        "columns": columns,
                        "rows": rows,
                        "sourceRefs": refs,
                        "origin": origin,
                    }
                )
    return out


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
        target["blocks"] = _normalize_blocks(blocks)
        target["status"] = "written" if target["blocks"] else "empty"
        _save_body(root, report_id, body)
        _save_manifest(root, report_id, _load_manifest(root, report_id))
    return target


def set_title(root: Path, report_id: str, title: str) -> dict[str, Any]:
    root = Path(root)
    name = (title or "").strip()
    if not name:
        raise ApiError("E_INVALID_TITLE", 400, "error.outlineEmpty")
    with WORKSPACE_MUTATION_LOCK:
        body = _load_body(root, report_id)
        body["title"] = name
        _save_body(root, report_id, body)
        manifest = _load_manifest(root, report_id)
        manifest["title"] = name
        _save_manifest(root, report_id, manifest)
    return body


# ---- 导出 ----


def _apply_style(paragraph: Any, style: dict[str, Any], document: Any) -> None:
    name = str(style.get("styleName") or "")
    if name:
        try:
            paragraph.style = document.styles[name]
        except KeyError:
            pass

    pf = paragraph.paragraph_format
    align = {
        "left": WD_ALIGN_PARAGRAPH.LEFT,
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "right": WD_ALIGN_PARAGRAPH.RIGHT,
        "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
    }.get(str(style.get("align") or ""))
    if align is not None:
        paragraph.alignment = align

    spacing = style.get("lineSpacing")
    if isinstance(spacing, (int, float)):
        if str(style.get("lineRule") or "").upper() == "EXACTLY":
            pf.line_spacing = Pt(float(spacing))
            pf.line_spacing_rule = WD_LINE_SPACING.EXACTLY
        else:
            pf.line_spacing = float(spacing)

    for key, setter in (
        ("firstLineIndent", "first_line_indent"),
        ("spaceBefore", "space_before"),
        ("spaceAfter", "space_after"),
    ):
        value = style.get(key)
        if isinstance(value, (int, float)):
            setattr(pf, setter, Pt(float(value)))


def _apply_run(run: Any, style: dict[str, Any]) -> None:
    if style.get("font"):
        run.font.name = str(style["font"])
    east = style.get("eastAsia")
    if east:
        rpr = run._element.get_or_add_rPr()
        rpr.get_or_add_rFonts().set(qn("w:eastAsia"), str(east))
    size = style.get("size")
    if isinstance(size, (int, float)):
        run.font.size = Pt(float(size))
    if style.get("bold") is not None:
        run.font.bold = bool(style["bold"])


def _add_text(
    document: Any,
    text: str,
    style: dict[str, Any],
    *,
    bullet: bool = False,
) -> Any:
    paragraph = document.add_paragraph()
    _apply_style(paragraph, style, document)
    if bullet:
        paragraph.paragraph_format.first_line_indent = Pt(0)
        text = f"· {text}"
    run = paragraph.add_run(text)
    _apply_run(run, style)
    return paragraph


def _clear_body(document: Any) -> None:
    body = document.element.body
    for child in list(body.iterchildren()):
        if child.tag.endswith("}sectPr"):
            continue
        body.remove(child)


def _heading_style(skeleton: dict[str, Any], level: int) -> dict[str, Any]:
    headings = skeleton.get("headings") or []
    for item in headings:
        if int(item.get("level") or 0) == level:
            return dict(item.get("style") or {})
    if headings:
        base = dict(headings[0].get("style") or {})
        body = dict(skeleton.get("body") or {})
        base_size = float(base.get("size") or body.get("size") or 16)
        base["size"] = base_size
        base["bold"] = True
        return base
    body = dict(skeleton.get("body") or {})
    return {
        **body,
        "bold": True,
        "size": float(body.get("size") or 16) + 2,
        "firstLineIndent": 0,
    }


def export_report(root: Path, report_id: str, *, title: str | None = None) -> dict[str, Any]:
    root = Path(root)
    from .report_verify import verify_report

    check = verify_report(root, report_id)
    if not check["ok"]:
        raise ApiError(
            "E_VERIFY_FAILED",
            409,
            "error.reportVerifyFailed",
            {"count": len(check["errors"])},
        )

    with WORKSPACE_MUTATION_LOCK:
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

        _clear_body(document)
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

        final_title = (title or body.get("title") or manifest.get("title") or report_id).strip()
        _add_text(document, final_title, title_style)

        for section in body.get("sections") or []:
            level = int(section.get("level") or 1)
            _add_text(document, str(section.get("title") or ""), _heading_style(skeleton, level))
            for block in section.get("blocks") or []:
                kind = block.get("type")
                if kind == "paragraph":
                    _add_text(document, str(block.get("text") or ""), body_style)
                elif kind == "bullets":
                    for item in block.get("items") or []:
                        _add_text(document, str(item), body_style, bullet=True)
                elif kind == "table":
                    columns = [str(c) for c in block.get("columns") or []]
                    if not columns:
                        continue
                    rows = [list(map(str, row)) for row in block.get("rows") or []]
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
                        cell = table.rows[0].cells[index]
                        cell.text = ""
                        run = cell.paragraphs[0].add_run(text)
                        header_style = {**cell_style, "bold": True}
                        _apply_style(cell.paragraphs[0], header_style, document)
                        _apply_run(run, header_style)
                    for row_index, row in enumerate(rows, start=1):
                        for col_index, text in enumerate(row[: len(columns)]):
                            cell = table.rows[row_index].cells[col_index]
                            cell.text = ""
                            run = cell.paragraphs[0].add_run(text)
                            _apply_style(cell.paragraphs[0], {**cell_style, "bold": False}, document)
                            _apply_run(run, {**cell_style, "bold": False})

        try:
            document.save(str(directory / "document.docx"))
        except OSError as exc:
            raise ApiError("E_FILE_WRITE", 500, "error.opFailed") from exc

        manifest["title"] = final_title
        manifest["status"] = _STATUS_SAVED
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
