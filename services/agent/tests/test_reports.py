"""项目报告：基于取证单快照渲染、保存与列表。"""

from __future__ import annotations

from pathlib import Path

import pytest
from docx import Document

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store.evidence_forms import (
    commit_evidence_form,
    delete_evidence_form,
    preview_evidence_form,
)
from fireeyeaud_agent.store.findings import create_finding
from fireeyeaud_agent.store.reports import (
    commit_report,
    delete_report,
    list_reports,
    preview_report,
)
from fireeyeaud_agent.store.templates import upload_template


def _form_template(path: Path) -> Path:
    doc = Document()
    doc.add_paragraph("项目：{{项目名称}}")
    doc.add_paragraph("编号：{{取证单编号}}")
    table = doc.add_table(rows=3, cols=2)
    table.cell(0, 0).text = "编号"
    table.cell(0, 1).text = "标题"
    table.cell(1, 0).text = "{{#疑点}}"
    table.cell(1, 1).text = "{{疑点.标题}}"
    table.cell(2, 0).text = "{{/疑点}}"
    doc.save(path)
    return path


def _report_template(path: Path) -> Path:
    doc = Document()
    doc.add_paragraph("报告：{{报告编号}}")
    doc.add_paragraph("取证单数量：{{取证单数量}}")
    doc.add_paragraph("疑点数量：{{疑点数量}}")
    table = doc.add_table(rows=3, cols=2)
    table.cell(0, 0).text = "编号"
    table.cell(0, 1).text = "标题"
    table.cell(1, 0).text = "{{#取证单}}"
    table.cell(1, 1).text = "{{取证单.编号}} {{取证单.标题}} {{取证单.疑点摘要}}"
    table.cell(2, 0).text = "{{/取证单}}"
    doc.save(path)
    return path


def _setup(tmp_path: Path, monkeypatch) -> tuple[str, str]:
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / ".fireeye").mkdir(parents=True, exist_ok=True)
    fid = create_finding(
        tmp_path,
        title="关联方交易",
        description="未披露",
        severity="high",
        dataRefs=[],
        sessionId="",
        origin="manual",
    )["id"]
    form_tpl = upload_template(
        tmp_path, _form_template(tmp_path / "f.docx"), kind="evidence-form", scope="project"
    )
    report_tpl = upload_template(
        tmp_path, _report_template(tmp_path / "r.docx"), kind="report", scope="project"
    )
    return fid, form_tpl["id"], report_tpl["id"]


def _make_form(tmp_path, fid, form_tpl_id, title="关联方取证单") -> dict:
    preview = preview_evidence_form(
        tmp_path,
        template_id=form_tpl_id,
        template_scope="project",
        finding_ids=[fid],
        header={"projectName": "年报审计"},
    )
    return commit_evidence_form(tmp_path, preview["token"], title=title)


def test_report_preview_and_commit(tmp_path, monkeypatch):
    fid, form_tpl_id, report_tpl_id = _setup(tmp_path, monkeypatch)
    form = _make_form(tmp_path, fid, form_tpl_id)

    preview = preview_report(
        tmp_path,
        template_id=report_tpl_id,
        template_scope="project",
        form_ids=[form["id"]],
        header={"projectName": "年报审计"},
    )
    assert (tmp_path / preview["relPath"]).is_file()

    rendered = Document(str(tmp_path / preview["relPath"]))
    table_text = "\n".join(
        c.text for t in rendered.tables for r in t.rows for c in r.cells
    )
    assert form["id"] in table_text
    assert "关联方取证单" in table_text
    assert "关联方交易" in table_text  # 疑点摘要

    manifest = commit_report(tmp_path, preview["token"], title="项目报告")
    assert manifest["id"] == "RPT-0001"
    assert manifest["formIds"] == [form["id"]]
    assert manifest["findingCount"] == 1
    assert manifest["formsSnapshot"][0]["findingCount"] == 1
    artifact = tmp_path / manifest["artifactRef"]
    assert (artifact / "document.docx").is_file()
    assert (artifact / "template.docx").is_file()
    assert list_reports(tmp_path)[0]["id"] == "RPT-0001"


def test_report_keeps_snapshot_after_form_deleted(tmp_path, monkeypatch):
    fid, form_tpl_id, report_tpl_id = _setup(tmp_path, monkeypatch)
    form = _make_form(tmp_path, fid, form_tpl_id)
    preview = preview_report(
        tmp_path,
        template_id=report_tpl_id,
        template_scope="project",
        form_ids=[form["id"]],
        header={},
    )
    manifest = commit_report(tmp_path, preview["token"])

    delete_evidence_form(tmp_path, form["id"])

    # 报告仍可读，且快照里有取证单与疑点
    stored = list_reports(tmp_path)[0]
    assert stored["id"] == manifest["id"]
    assert stored["formsSnapshot"][0]["id"] == form["id"]
    assert stored["formsSnapshot"][0]["findings"][0]["title"] == "关联方交易"


def test_report_rejects_bad_inputs(tmp_path, monkeypatch):
    fid, form_tpl_id, report_tpl_id = _setup(tmp_path, monkeypatch)
    form = _make_form(tmp_path, fid, form_tpl_id)

    with pytest.raises(ApiError) as exc:
        preview_report(
            tmp_path,
            template_id=report_tpl_id,
            template_scope="project",
            form_ids=[],
            header={},
        )
    assert exc.value.code == "E_FORMS_REQUIRED"

    with pytest.raises(ApiError) as exc2:
        preview_report(
            tmp_path,
            template_id=report_tpl_id,
            template_scope="project",
            form_ids=["QZ-9999"],
            header={},
        )
    assert exc2.value.code == "E_FORMS_REQUIRED"

    # 用取证单模板生成报告 → 类型不匹配
    with pytest.raises(ApiError) as exc3:
        preview_report(
            tmp_path,
            template_id=form_tpl_id,
            template_scope="project",
            form_ids=[form["id"]],
            header={},
        )
    assert exc3.value.code == "E_TEMPLATE_KIND"


def test_report_delete(tmp_path, monkeypatch):
    fid, form_tpl_id, report_tpl_id = _setup(tmp_path, monkeypatch)
    form = _make_form(tmp_path, fid, form_tpl_id)
    preview = preview_report(
        tmp_path,
        template_id=report_tpl_id,
        template_scope="project",
        form_ids=[form["id"]],
        header={},
    )
    manifest = commit_report(tmp_path, preview["token"])

    delete_report(tmp_path, manifest["id"])
    assert list_reports(tmp_path) == []
    assert not (tmp_path / manifest["artifactRef"]).exists()


def test_report_orders_forms_as_requested(tmp_path, monkeypatch):
    fid, form_tpl_id, report_tpl_id = _setup(tmp_path, monkeypatch)
    second_fid = create_finding(
        tmp_path,
        title="收入截止",
        description="",
        severity="medium",
        dataRefs=[],
        sessionId="",
        origin="manual",
    )["id"]
    first = _make_form(tmp_path, fid, form_tpl_id, title="第一份")
    second = preview_evidence_form(
        tmp_path,
        template_id=form_tpl_id,
        template_scope="project",
        finding_ids=[second_fid],
        header={},
    )
    second_form = commit_evidence_form(tmp_path, second["token"], title="第二份")

    preview = preview_report(
        tmp_path,
        template_id=report_tpl_id,
        template_scope="project",
        form_ids=[second_form["id"], first["id"]],
        header={},
    )
    manifest = commit_report(tmp_path, preview["token"])
    assert manifest["formIds"] == [second_form["id"], first["id"]]
    assert [f["title"] for f in manifest["formsSnapshot"]] == ["第二份", "第一份"]