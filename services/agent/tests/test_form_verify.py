"""取证单校验：大纲、空章节、疑点引用、金额可追溯。"""

from __future__ import annotations

from pathlib import Path

import pytest

from fireeyeaud_agent.store import form_docs, form_verify

from test_form_docs import _finding, _setup


@pytest.fixture(autouse=True)
def _global_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))


def _create(root: Path, template_id: str, finding_id: str) -> None:
    form_docs.create_form(
        root, template_id=template_id, template_scope="project", finding_ids=[finding_id]
    )


def _write(root: Path, section_id: str, blocks: list[dict]) -> None:
    form_docs.write_section(root, "QZ-0001", section_id, blocks)


def _codes(result: dict) -> set[str]:
    return {issue["code"] for issue in result["errors"]}


def test_unapproved_and_empty_sections(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    _create(root, template_id, finding_id)
    result = form_verify.verify_form(root, "QZ-0001")
    codes = _codes(result)
    assert "E_OUTLINE_NOT_APPROVED" in codes
    assert "E_SECTION_EMPTY" in codes
    assert result["ok"] is False


def test_cited_and_amounts_pass(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    _create(root, template_id, finding_id)
    form_docs.set_outline(
        root, "QZ-0001", [{"title": "一、事项经过", "level": 1}], approved=True
    )
    _write(
        root,
        "S1",
        [{"type": "paragraph", "text": "关联方交易未披露。", "sourceRefs": [finding_id]}],
    )
    result = form_verify.verify_form(root, "QZ-0001")
    assert result["ok"] is True, result["errors"]


def test_uncited_and_unknown_refs(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    _create(root, template_id, finding_id)
    form_docs.set_outline(root, "QZ-0001", [{"title": "一、事项经过", "level": 1}], approved=True)
    _write(
        root,
        "S1",
        [
            {"type": "paragraph", "text": "无来源的一段话。"},
            {"type": "paragraph", "text": "引用了别处。", "sourceRefs": ["F-9999"]},
        ],
    )
    codes = _codes(form_verify.verify_form(root, "QZ-0001"))
    assert "E_UNCITED" in codes
    assert "E_UNKNOWN_SOURCE" in codes


def test_uncited_amount_is_blocked(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    _create(root, template_id, finding_id)
    form_docs.set_outline(root, "QZ-0001", [{"title": "一、事项经过", "level": 1}], approved=True)
    _write(
        root,
        "S1",
        [{"type": "paragraph", "text": "金额为8888元。", "sourceRefs": [finding_id]}],
    )
    result = form_verify.verify_form(root, "QZ-0001")
    assert any(issue["code"] == "E_AMOUNT_UNTRACED" for issue in result["errors"])


def test_user_origin_skips_citation(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    _create(root, template_id, finding_id)
    form_docs.set_outline(root, "QZ-0001", [{"title": "一、事项经过", "level": 1}], approved=True)
    _write(
        root,
        "S1",
        [{"type": "paragraph", "text": "经部门负责人审阅。", "origin": "user"}],
    )
    assert form_verify.verify_form(root, "QZ-0001")["ok"] is True


def test_stats_count_blocks_and_chars(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    _create(root, template_id, finding_id)
    form_docs.set_outline(root, "QZ-0001", [{"title": "一、事项经过", "level": 1}], approved=True)
    _write(
        root,
        "S1",
        [{"type": "bullets", "items": ["甲", "乙"], "sourceRefs": [finding_id]}],
    )
    stats = form_verify.verify_form(root, "QZ-0001")["stats"]
    assert stats["sectionCount"] == 1
    assert stats["blockCount"] == 1
    assert stats["charCount"] == 3


def test_template_sections_missing_warns(tmp_path):
    """模板有「一、基本情况」「二、取证内容」，大纲只保留一节时应给提醒。"""
    root, template_id, finding_id = _setup(tmp_path)
    _create(root, template_id, finding_id)
    form_docs.set_outline(root, "QZ-0001", [{"title": "一、基本情况", "level": 1}], approved=True)
    _write(
        root,
        "S1",
        [{"type": "paragraph", "text": "关联方交易未披露。", "sourceRefs": [finding_id]}],
    )
    result = form_verify.verify_form(root, "QZ-0001")
    assert result["ok"] is True
    assert any(
        issue["code"] == "W_TEMPLATE_SECTION_MISSING" for issue in result["warnings"]
    )