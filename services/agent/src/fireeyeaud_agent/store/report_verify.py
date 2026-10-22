"""报告校验器（方案 B 的最后一环）。

把「格式与内容是否靠得住」变成可检查的规则：
- 大纲必须确认、章节不能为空；
- 段落必须能追溯到选中的取证单，或明确标记为用户指令；
- 引用的取证单必须在本报告范围内；
- 报告里出现的金额必须能在取证单快照中找到。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .report_docs import get_document

_AMOUNT_RE = re.compile(r"(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(亿元|万元|元)")
_FORM_REF_RE = re.compile(r"QZ-\d{4,}")
_UNIT = {"元": 1, "万元": 10000, "亿元": 100000000}


def _issue(code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"code": code, "message": message, **extra}


def _amount_value(number: str, unit: str) -> float | None:
    try:
        value = float(number.replace(",", ""))
    except ValueError:
        return None
    return round(value * _UNIT.get(unit, 1), 2)


def _corpus_amounts(manifest: dict[str, Any]) -> set[float]:
    """取证单快照里的金额（结构化 amount + 描述文本里的金额），统一换算成元。"""
    values: set[float] = set()

    def add(number: str, unit: str) -> None:
        value = _amount_value(number, unit)
        if value is not None:
            values.add(value)

    for form in manifest.get("formsSnapshot") or []:
        for finding in form.get("findings") or []:
            amount = finding.get("amount")
            if amount not in (None, ""):
                add(str(amount), "元")
            for match in _AMOUNT_RE.finditer(str(finding.get("description") or "")):
                add(match.group(1), match.group(2))
    return values


def _block_text(block: dict[str, Any]) -> str:
    kind = block.get("type")
    if kind == "paragraph":
        return str(block.get("text") or "")
    if kind == "bullets":
        return "\n".join(str(item) for item in block.get("items") or [])
    if kind == "table":
        columns = " ".join(str(item) for item in block.get("columns") or [])
        rows = "\n".join(" ".join(str(cell) for cell in row) for row in block.get("rows") or [])
        return f"{columns}\n{rows}"
    return ""


def verify_report(root: Path, report_id: str) -> dict[str, Any]:
    doc = get_document(Path(root), report_id)
    body = doc["body"]
    manifest = doc["manifest"]
    skeleton = doc["skeleton"] or {}

    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    selected = {str(item) for item in body.get("selectedFormIds") or []}
    sections = list(body.get("sections") or [])

    if not str(body.get("title") or "").strip():
        errors.append(_issue("E_TITLE_EMPTY", "报告还没有标题。"))
    if not body.get("outlineApproved"):
        errors.append(
            _issue("E_OUTLINE_NOT_APPROVED", "大纲尚未确认，请先在预览区确认大纲。")
        )
    if not sections:
        errors.append(_issue("E_OUTLINE_EMPTY", "报告还没有章节。"))

    amounts = _corpus_amounts(manifest)

    seen_titles: set[str] = set()
    block_count = 0
    char_count = 0

    for section in sections:
        section_id = str(section.get("id") or "")
        title = str(section.get("title") or "")
        if title in seen_titles:
            errors.append(
                _issue("E_DUPLICATE_SECTION", f"章节标题重复：{title}", sectionId=section_id)
            )
        seen_titles.add(title)

        blocks = list(section.get("blocks") or [])
        if not blocks:
            errors.append(
                _issue(
                    "E_SECTION_EMPTY",
                    f"章节「{title or section_id}」还没有内容。",
                    sectionId=section_id,
                )
            )
            continue

        for block in blocks:
            block_count += 1
            text = _block_text(block)
            char_count += len(text)
            refs = [str(item) for item in block.get("sourceRefs") or []]

            for ref in refs:
                if ref not in selected:
                    errors.append(
                        _issue(
                            "E_UNKNOWN_SOURCE",
                            f"章节「{title}」引用了未选中的取证单 {ref}。",
                            sectionId=section_id,
                            ref=ref,
                        )
                    )

            origin = str(block.get("origin") or "form")
            if origin != "user" and not refs:
                errors.append(
                    _issue(
                        "E_UNCITED",
                        f"章节「{title}」有一段内容没有标注来源，请补充取证单编号或标记为用户指令。",
                        sectionId=section_id,
                    )
                )

            if origin != "user":
                for match in _AMOUNT_RE.finditer(text):
                    value = _amount_value(match.group(1), match.group(2))
                    if value is None or not any(
                        abs(value - known) <= 0.01 for known in amounts
                    ):
                        errors.append(
                            _issue(
                                "E_AMOUNT_UNTRACED",
                                f"章节「{title}」中的金额 {match.group(0).strip()} 在取证单里找不到依据。",
                                sectionId=section_id,
                                amount=match.group(0).strip(),
                            )
                        )

            for form_ref in _FORM_REF_RE.findall(text):
                if form_ref not in selected:
                    errors.append(
                        _issue(
                            "E_UNKNOWN_SOURCE",
                            f"章节「{title}」提到了未选中的取证单 {form_ref}。",
                            sectionId=section_id,
                            ref=form_ref,
                        )
                    )

    skeleton_titles = {str(item.get("title") or "") for item in skeleton.get("sections") or []}
    if skeleton_titles:
        missing = [title for title in skeleton_titles if title and title not in seen_titles]
        if missing:
            warnings.append(
                _issue(
                    "W_TEMPLATE_SECTION_MISSING",
                    "模板中的章节未出现在当前大纲：" + "、".join(missing),
                    sections=missing,
                )
            )

    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "stats": {
            "sectionCount": len(sections),
            "blockCount": block_count,
            "charCount": char_count,
        },
    }
