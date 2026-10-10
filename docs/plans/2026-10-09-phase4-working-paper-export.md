# Phase 4 — 审计底稿导出 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 建议按里程碑（N→O→P→Q）分批执行，每个里程碑结束运行一次验证并以一次提交收尾。

**Goal:** 由现有疑点 + 证据 + 工作区信息一键生成可归档的审计工作底稿（Word / Excel / PDF），落盘 `.fireeye/artifacts/working-paper/`，并在成果栏「底稿预览」tab 查看历史产物、打开文件或所在目录。

**Architecture:** 后端新增 `store/working_paper.py`：先 `collect_material`（一次性汇总 findings/evidence/project），再由三个格式渲染器分别产出 `.docx`（python-docx）/ `.xlsx`（openpyxl）/ `.pdf`（reportlab + 内置 CJK 字体 `STSong-Light`）并写 `manifest.json`；`api/export.py` 暴露 `POST/GET /export/working-paper` 与 `GET /artifacts/{path}`。前端 `WorkingPaperView` 挂载在 `ResultsColumn` 的 `working-paper` tab，导出后通过新增 Electron IPC（`shell:open-path` / `shell:show-item`）打开文件/所在目录。

**Tech Stack:** Python 3.12 · FastAPI · python-docx · openpyxl · reportlab · React 18 · Zustand · Electron `shell`

---

## 决策与偏差（执行前须知，2026-10-09 用户确认）

1. **格式范围**：`word` / `xlsx` / `pdf` 三种；PDF 用 reportlab 内置 CJK 字体（`UnicodeCIDFont('STSong-Light')`），不依赖外部二进制与字体文件。
2. **底稿预览 tab**：**列表 + 打开所在目录**——生成后列出历次导出（时间/格式/疑点数/文件），提供「打开文件」与「在文件夹中显示」；不内嵌渲染文档。
3. **模板机制**：**仅内置默认模板**（结构：封面 / 审计结论 / 疑点汇总 / 证据索引 / 附录）；项目覆盖与 `templateId` 仅保留参数占位，不读取 `.fireeye/templates/`。
4. **导出范围**：`findingIds` 可选；缺省导出全部疑点；前端支持「全部 / 仅选中疑点」。
5. **产物目录**：`.fireeye/artifacts/working-paper/<id>/`，`<id> = wp_<n>`（4 位补零，`project.counters.workingPaper`，已存在该计数器）；目录名用 id 而非设计文档示例的 `<ts>`（便于定位，记为本期偏差）。
6. **语言**：导出文案（标题/表头/枚举标签）随请求 `locale`（默认 `zh-CN`）；枚举标签在后端内置最小映射表。

---

## 里程碑总览

| 里程碑 | 内容 | 交付 |
|---|---|---|
| N | 后端底稿生成（docx/xlsx/pdf + manifest） | 由 findings 生成三种格式 + manifest |
| O | 后端导出 REST | `POST/GET /export/working-paper`、`GET /artifacts/{path}` |
| P | 前端底稿预览 tab + 打开文件 IPC | 成果栏可导出/查看/打开产物 |
| Q | 端到端验收 + 文档 | 完整 Phase 4 |

---

## 里程碑 N — 后端底稿生成

### Task N1: 依赖 + 材料汇总 + Word 生成 + manifest/列表

**Files:**
- Modify: `services/agent/pyproject.toml`（新增 `python-docx`、`reportlab`）
- Create: `services/agent/src/fireeyeaud_agent/store/working_paper.py`
- Test: `services/agent/tests/test_working_paper_store.py`

**Step 1: 安装依赖**

Run: `cd services/agent && uv add python-docx reportlab`
Expected: `pyproject.toml` / `uv.lock` 更新，`uv sync` 后 `import docx`、`import reportlab` 可用。

**Step 2: 写失败测试**

```python
import json
from pathlib import Path

from fireeyeaud_agent.store.evidence import append_evidence
from fireeyeaud_agent.store.findings import create_finding
from fireeyeaud_agent.store.working_paper import (
    create_working_paper,
    list_working_papers,
)


def _seed(root: Path) -> dict:
    (root / ".fireeye").mkdir()
    ev = append_evidence(
        root, session_id="s_1", step="tool_call", tool="sql_query"
    )
    return create_finding(
        root,
        title="大额往来",
        description="测试疑点",
        severity="high",
        dataRefs=[{"sourceId": "ds_1", "table": "src_ds1_序时账", "rowRef": "1182"}],
        sessionId="s_1",
        ruleKey="tie_check",
        evidenceRefs=[ev["id"]],
    )


def test_create_working_paper_docx(tmp_path):
    finding = _seed(tmp_path)
    manifest = create_working_paper(
        tmp_path, format="word", locale="zh-CN", finding_ids=None
    )
    assert manifest["id"].startswith("wp_")
    assert manifest["format"] == "word"
    assert manifest["findingIds"] == [finding["id"]]
    assert manifest["files"] == ["底稿.docx"]

    base = tmp_path / ".fireeye" / "artifacts" / "working-paper" / manifest["id"]
    assert (base / "manifest.json").exists()
    docx = base / "底稿.docx"
    assert docx.exists() and docx.stat().st_size > 0

    on_disk = json.loads((base / "manifest.json").read_text("utf-8"))
    assert on_disk["id"] == manifest["id"]


def test_create_working_paper_filter_by_finding(tmp_path):
    a = _seed(tmp_path)
    create_finding(
        tmp_path, title="b", description="d", severity="low", dataRefs=[], sessionId="s_1"
    )
    manifest = create_working_paper(
        tmp_path, format="word", locale="zh-CN", finding_ids=[a["id"]]
    )
    assert manifest["findingIds"] == [a["id"]]


def test_list_working_papers_newest_first(tmp_path):
    _seed(tmp_path)
    first = create_working_paper(tmp_path, format="word", locale="zh-CN", finding_ids=None)
    second = create_working_paper(tmp_path, format="word", locale="zh-CN", finding_ids=None)
    items = list_working_papers(tmp_path)
    assert [m["id"] for m in items] == [second["id"], first["id"]]


def test_list_working_papers_empty(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    assert list_working_papers(tmp_path) == []
```

**Step 3: 运行失败**

Run: `cd services/agent && uv run pytest tests/test_working_paper_store.py -v`
Expected: FAIL（`ModuleNotFoundError`）

**Step 4: 实现 `store/working_paper.py`**

```python
"""审计工作底稿生成与产物清单（设计 §14.15）。

结构：封面 / 审计结论 / 疑点汇总 / 证据索引 / 附录。
产物：`.fireeye/artifacts/working-paper/<id>/{底稿.*, manifest.json}`。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..util import now_iso
from .evidence import load_evidence
from .findings import load_findings
from .project import next_counter, load_project

_TITLE = {"zh-CN": "审计工作底稿", "en-US": "Audit Working Paper"}
_HEADINGS = {
    "zh-CN": {
        "conclusion": "审计结论",
        "findings": "疑点汇总",
        "evidence": "证据索引",
        "appendix": "附录",
        "workspace": "工作区",
        "generatedAt": "生成时间",
        "counts": "疑点统计",
        "id": "编号",
        "severity": "风险",
        "status": "状态",
        "title": "标题",
        "amount": "金额",
        "subjects": "科目",
        "tool": "工具",
        "step": "步骤",
        "ts": "时间",
    },
    "en-US": {
        "conclusion": "Conclusion",
        "findings": "Findings summary",
        "evidence": "Evidence index",
        "appendix": "Appendix",
        "workspace": "Workspace",
        "generatedAt": "Generated at",
        "counts": "Findings",
        "id": "ID",
        "severity": "Severity",
        "status": "Status",
        "title": "Title",
        "amount": "Amount",
        "subjects": "Subjects",
        "tool": "Tool",
        "step": "Step",
        "ts": "Time",
    },
}
_SEVERITY = {
    "zh-CN": {"high": "高", "medium": "中", "low": "低"},
    "en-US": {"high": "High", "medium": "Medium", "low": "Low"},
}
_STATUS = {
    "zh-CN": {
        "pending": "待复核",
        "in_review": "复核中",
        "confirmed": "已确认",
        "rejected": "已驳回",
        "false_positive": "误报",
    },
    "en-US": {
        "pending": "Pending",
        "in_review": "In review",
        "confirmed": "Confirmed",
        "rejected": "Rejected",
        "false_positive": "False positive",
    },
}
_FILE = {"word": "底稿.docx", "xlsx": "底稿.xlsx", "pdf": "底稿.pdf"}


def working_paper_dir(root: Path) -> Path:
    return Path(root) / ".fireeye" / "artifacts" / "working-paper"


def collect_material(root: Path, finding_ids: list[str] | None) -> dict[str, Any]:
    root = Path(root)
    fe = root / ".fireeye"
    findings = load_findings(root)
    if finding_ids:
        wanted = set(finding_ids)
        findings = [f for f in findings if f.get("id") in wanted]
    evidence_by_id = {e["id"]: e for e in load_evidence(root, limit=100000)}
    project = load_project(fe) or {}
    return {
        "workspaceName": project.get("name") or root.name,
        "generatedAt": now_iso(),
        "findings": findings,
        "evidence": evidence_by_id,
    }


def _labels(locale: str) -> dict[str, str]:
    return _HEADINGS.get(locale, _HEADINGS["zh-CN"])


def _title(locale: str) -> str:
    return _TITLE.get(locale, _TITLE["zh-CN"])


def _finding_title(finding: dict[str, Any]) -> str:
    title = finding.get("title")
    return (title or {}).get("text") or finding.get("ruleKey") or finding.get("id") or ""


def _counts(findings: list[dict[str, Any]]) -> dict[str, int]:
    result = {"high": 0, "medium": 0, "low": 0}
    for f in findings:
        key = f.get("severity")
        if key in result:
            result[key] += 1
    return result


def _write_manifest(base: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    base.mkdir(parents=True, exist_ok=True)
    (base / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8"
    )
    return manifest


def _render_docx(base: Path, material: dict[str, Any], locale: str) -> None:
    from docx import Document

    L = _labels(locale)
    findings = material["findings"]
    doc = Document()
    doc.add_heading(_title(locale), level=0)
    doc.add_paragraph(f"{L['workspace']}: {material['workspaceName']}")
    doc.add_paragraph(f"{L['generatedAt']}: {material['generatedAt']}")

    doc.add_heading(L["conclusion"], level=1)
    counts = _counts(findings)
    doc.add_paragraph(
        f"{L['counts']}: " + ", ".join(f"{k}={v}" for k, v in counts.items())
    )

    doc.add_heading(L["findings"], level=1)
    table = doc.add_table(rows=1, cols=6)
    for i, key in enumerate(["id", "severity", "status", "title", "amount", "subjects"]):
        table.rows[0].cells[i].text = L[key]
    sev = _SEVERITY.get(locale, _SEVERITY["zh-CN"])
    st = _STATUS.get(locale, _STATUS["zh-CN"])
    for f in findings:
        cells = table.add_row().cells
        cells[0].text = f.get("id", "")
        cells[1].text = sev.get(f.get("severity"), f.get("severity", ""))
        cells[2].text = st.get(f.get("status"), f.get("status", ""))
        cells[3].text = _finding_title(f)
        cells[4].text = str(f.get("amount") or "")
        cells[5].text = "、".join(f.get("subjects") or [])

    doc.add_heading(L["evidence"], level=1)
    for f in findings:
        for ev_id in f.get("evidenceRefs") or []:
            ev = material["evidence"].get(ev_id)
            if not ev:
                continue
            doc.add_paragraph(
                f"{f.get('id')} · {ev.get('tool') or ev.get('step')} · {ev.get('ts')}"
            )

    doc.add_heading(L["appendix"], level=1)
    doc.add_paragraph(f"templateId: default")
    doc.save(str(base / _FILE["word"]))


def create_working_paper(
    root: Path,
    *,
    format: str,
    locale: str = "zh-CN",
    finding_ids: list[str] | None = None,
    template_id: str = "default",
) -> dict[str, Any]:
    root = Path(root)
    if format not in _FILE:
        from ..errors import ApiError

        raise ApiError("E_EXPORT_FORMAT", 400, "error.exportFormat", {"format": format})
    fe = root / ".fireeye"
    material = collect_material(root, finding_ids)
    seq = next_counter(fe, "workingPaper", root)
    wp_id = f"wp_{seq:04d}"
    base = working_paper_dir(root) / wp_id
    base.mkdir(parents=True, exist_ok=True)

    if format == "word":
        _render_docx(base, material, locale)

    manifest = {
        "id": wp_id,
        "createdAt": material["generatedAt"],
        "format": format,
        "locale": locale,
        "templateId": template_id,
        "findingIds": [f["id"] for f in material["findings"]],
        "artifactRef": f"working-paper/{wp_id}",
        "files": [_FILE[format]],
    }
    return _write_manifest(base, manifest)


def list_working_papers(root: Path) -> list[dict[str, Any]]:
    base = working_paper_dir(Path(root))
    if not base.exists():
        return []
    items: list[tuple[str, dict[str, Any]]] = []
    for child in base.iterdir():
        manifest = child / "manifest.json"
        if not manifest.exists():
            continue
        try:
            data = json.loads(manifest.read_text("utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        items.append((data.get("createdAt", ""), data))
    items.sort(key=lambda pair: pair[0], reverse=True)
    return [data for _, data in items]
```

> `_render_xlsx` / `_render_pdf` 在 N2 补入；`create_working_paper` 中对应分支也在 N2 补入。

**Step 5: 运行通过**

Run: `cd services/agent && uv run pytest tests/test_working_paper_store.py -v`
Expected: PASS（4 passed）

**Step 6: Commit**

```bash
git add services/agent/pyproject.toml services/agent/uv.lock services/agent/src/fireeyeaud_agent/store/working_paper.py services/agent/tests/test_working_paper_store.py
git commit -m "feat(agent): 工作底稿生成基础（材料汇总 + Word + manifest）"
```

---

### Task N2: Excel 与 PDF 生成

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/working_paper.py`
- Test: `services/agent/tests/test_working_paper_store.py`（追加）

**Step 1: 写失败测试（追加）**

```python
def test_create_working_paper_xlsx(tmp_path):
    finding = _seed(tmp_path)
    manifest = create_working_paper(
        tmp_path, format="xlsx", locale="zh-CN", finding_ids=None
    )
    assert manifest["files"] == ["底稿.xlsx"]
    base = tmp_path / ".fireeye" / "artifacts" / "working-paper" / manifest["id"]
    book = base / "底稿.xlsx"
    assert book.exists() and book.stat().st_size > 0
    from openpyxl import load_workbook

    wb = load_workbook(book)
    assert "疑点汇总" in wb.sheetnames
    ws = wb["疑点汇总"]
    assert ws.cell(row=1, column=1).value == "编号"
    assert ws.cell(row=2, column=1).value == finding["id"]


def test_create_working_paper_pdf(tmp_path):
    _seed(tmp_path)
    manifest = create_working_paper(
        tmp_path, format="pdf", locale="zh-CN", finding_ids=None
    )
    assert manifest["files"] == ["底稿.pdf"]
    base = tmp_path / ".fireeye" / "artifacts" / "working-paper" / manifest["id"]
    pdf = base / "底稿.pdf"
    assert pdf.exists() and pdf.stat().st_size > 0
    assert pdf.read_bytes()[:5] == b"%PDF-"


def test_create_working_paper_bad_format(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    import pytest
    from fireeyeaud_agent.errors import ApiError

    with pytest.raises(ApiError):
        create_working_paper(tmp_path, format="doc", locale="zh-CN", finding_ids=None)
```

**Step 2: 运行失败**

Run: `cd services/agent && uv run pytest tests/test_working_paper_store.py -v`
Expected: FAIL（xlsx/pdf 未实现，文件不存在）

**Step 3: 实现 `_render_xlsx` / `_render_pdf` 并在 `create_working_paper` 分支调用**

在 `_render_docx` 之后追加：

```python
def _render_xlsx(base: Path, material: dict[str, Any], locale: str) -> None:
    from openpyxl import Workbook

    L = _labels(locale)
    sev = _SEVERITY.get(locale, _SEVERITY["zh-CN"])
    st = _STATUS.get(locale, _STATUS["zh-CN"])
    findings = material["findings"]
    wb = Workbook()

    summary = wb.active
    summary.title = L["findings"]
    summary.append([L["id"], L["severity"], L["status"], L["title"], L["amount"], L["subjects"]])
    for f in findings:
        summary.append([
            f.get("id", ""),
            sev.get(f.get("severity"), f.get("severity", "")),
            st.get(f.get("status"), f.get("status", "")),
            _finding_title(f),
            str(f.get("amount") or ""),
            "、".join(f.get("subjects") or []),
        ])

    evidence = wb.create_sheet(L["evidence"])
    evidence.append([L["id"], L["tool"], L["step"], L["ts"]])
    for f in findings:
        for ev_id in f.get("evidenceRefs") or []:
            ev = material["evidence"].get(ev_id)
            if not ev:
                continue
            evidence.append(
                [f.get("id", ""), ev.get("tool") or "", ev.get("step") or "", ev.get("ts") or ""]
            )
    wb.save(str(base / _FILE["xlsx"]))


def _render_pdf(base: Path, material: dict[str, Any], locale: str) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from reportlab.lib import colors

    font = "STSong-Light"
    pdfmetrics.registerFont(UnicodeCIDFont(font))
    L = _labels(locale)
    findings = material["findings"]
    sev = _SEVERITY.get(locale, _SEVERITY["zh-CN"])
    st = _STATUS.get(locale, _STATUS["zh-CN"])
    title_style = ParagraphStyle("title", fontName=font, fontSize=18, leading=24)
    head_style = ParagraphStyle("head", fontName=font, fontSize=13, leading=18)
    body_style = ParagraphStyle("body", fontName=font, fontSize=10, leading=14)

    story: list[Any] = [
        Paragraph(_title(locale), title_style),
        Spacer(1, 6 * mm),
        Paragraph(f"{L['workspace']}: {material['workspaceName']}", body_style),
        Paragraph(f"{L['generatedAt']}: {material['generatedAt']}", body_style),
        Spacer(1, 4 * mm),
        Paragraph(L["conclusion"], head_style),
    ]
    counts = _counts(findings)
    story.append(
        Paragraph(
            f"{L['counts']}: " + ", ".join(f"{k}={v}" for k, v in counts.items()),
            body_style,
        )
    )
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph(L["findings"], head_style))

    data = [[L["id"], L["severity"], L["status"], L["title"], L["amount"]]]
    for f in findings:
        data.append([
            f.get("id", ""),
            sev.get(f.get("severity"), f.get("severity", "")),
            st.get(f.get("status"), f.get("status", "")),
            _finding_title(f),
            str(f.get("amount") or ""),
        ])
    table = Table(data, colWidths=[22 * mm, 18 * mm, 24 * mm, 70 * mm, 30 * mm])
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), font),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
    ]))
    story.append(table)

    doc = SimpleDocTemplate(str(base / _FILE["pdf"]), pagesize=A4)
    doc.build(story)
```

在 `create_working_paper` 的格式分支补：

```python
    if format == "word":
        _render_docx(base, material, locale)
    elif format == "xlsx":
        _render_xlsx(base, material, locale)
    elif format == "pdf":
        _render_pdf(base, material, locale)
```

**Step 4: 运行通过**

Run: `cd services/agent && uv run pytest tests/test_working_paper_store.py -v`
Expected: PASS（7 passed）

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/working_paper.py services/agent/tests/test_working_paper_store.py
git commit -m "feat(agent): 工作底稿 Excel 与 PDF 生成"
```

---

## 里程碑 O — 后端导出 REST

### Task O1: 导出与产物路由

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/api/export.py`
- Modify: `services/agent/src/fireeyeaud_agent/main.py`
- Modify: `services/agent/src/fireeyeaud_agent/errors.py`（新错误码 `E_EXPORT_FORMAT` / `E_EXPORT_EMPTY` / `error.exportFormat` / `error.exportEmpty`）
- Test: `services/agent/tests/test_export_api.py`

**Step 1: 写失败测试**

```python
import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store.findings import create_finding


async def test_export_working_paper_api(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        create_finding(
            tmp_path, title="t", description="d", severity="high",
            dataRefs=[], sessionId="s_1",
        )
        res = await client.post(
            "/api/v1/export/working-paper",
            json={"format": "word", "locale": "zh-CN"},
        )
        assert res.status_code == 200
        manifest = res.json()
        assert manifest["format"] == "word"
        assert manifest["findingIds"] == ["F-0001"]

        listed = (await client.get("/api/v1/export/working-paper")).json()["items"]
        assert [m["id"] for m in listed] == [manifest["id"]]

        rel = f"{manifest['artifactRef']}/{manifest['files'][0]}"
        art = await client.get(f"/api/v1/artifacts/{rel}")
        assert art.status_code == 200
        assert len(art.content) > 0
        await client.post("/api/v1/workspaces/close")


async def test_export_no_workspace():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/v1/export/working-paper")).json() == {"items": []}
        res = await client.post(
            "/api/v1/export/working-paper", json={"format": "word"}
        )
        assert res.status_code == 400


async def test_artifacts_rejects_traversal(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        res = await client.get("/api/v1/artifacts/..%2F..%2Fproject.json")
        assert res.status_code in (400, 404)
        await client.post("/api/v1/workspaces/close")
```

**Step 2: 运行失败** — `uv run pytest tests/test_export_api.py -v` → FAIL（404）

**Step 3: 实现 `api/export.py`**

```python
"""工作底稿导出与产物读取（设计 §14.8 / §14.15）。"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..errors import ApiError
from ..store.working_paper import create_working_paper, list_working_papers
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["export"], dependencies=[Depends(require_token)])


class ExportBody(BaseModel):
    findingIds: list[str] | None = None
    format: str
    locale: str = "zh-CN"
    templateId: str | None = None


@router.get("/export/working-paper")
def get_working_papers() -> dict:
    if workspace_manager.root is None:
        return {"items": []}
    return {"items": list_working_papers(workspace_manager.root)}


@router.post("/export/working-paper")
def post_working_paper(body: ExportBody) -> dict:
    if workspace_manager.root is None:
        raise ApiError("E_NO_WORKSPACE", 400, "error.noWorkspace")
    return create_working_paper(
        workspace_manager.root,
        format=body.format,
        locale=body.locale,
        finding_ids=body.findingIds,
        template_id=body.templateId or "default",
    )


@router.get("/artifacts/{path:path}")
def get_artifact(path: str) -> FileResponse:
    if workspace_manager.root is None:
        raise ApiError("E_NO_WORKSPACE", 400, "error.noWorkspace")
    base = (Path(workspace_manager.root) / ".fireeye" / "artifacts").resolve()
    target = (base / path).resolve()
    if base not in target.parents and target != base:
        raise ApiError("E_ARTIFACT_NOT_FOUND", 404, "error.artifactNotFound")
    if not target.is_file():
        raise ApiError("E_ARTIFACT_NOT_FOUND", 404, "error.artifactNotFound")
    return FileResponse(target)
```

`main.py`：`from .api import ... export ...`；`app.include_router(export.router, prefix=API_PREFIX)`。

**Step 4: 运行通过** — `uv run pytest tests/test_export_api.py -v` → PASS

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/api/export.py services/agent/src/fireeyeaud_agent/main.py services/agent/src/fireeyeaud_agent/errors.py services/agent/tests/test_export_api.py
git commit -m "feat(agent): 工作底稿导出与产物 REST"
```

---

## 里程碑 P — 前端底稿预览

### Task P1: Electron IPC（打开文件 / 在文件夹中显示）

**Files:**
- Modify: `apps/desktop/src/main.cjs`（`shell` + `shell:open-path` / `shell:show-item`）
- Modify: `apps/desktop/src/preload.cjs`
- Modify: `apps/renderer/src/env.d.ts`
- Modify: `apps/desktop/test/sidecar.test.mjs`（导出 `registerIpc` 难以单测，改测纯函数 `resolveArtifactPath`？见下）

**Step 1: main.cjs** 顶部引入 `shell`；`registerIpc()` 追加：

```js
  ipcMain.handle('shell:open-path', (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return { ok: false };
    return shell.openPath(filePath).then((err) => ({ ok: !err }));
  });
  ipcMain.handle('shell:show-item', (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return { ok: false };
    shell.showItemInFolder(filePath);
    return { ok: true };
  });
```

`const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');`

**Step 2: preload.cjs** 追加：

```js
  openPath: (filePath) => ipcRenderer.invoke('shell:open-path', filePath),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:show-item', filePath),
```

**Step 3: env.d.ts** 追加类型：

```ts
      openPath: (filePath: string) => Promise<{ ok: boolean }>;
      showItemInFolder: (filePath: string) => Promise<{ ok: boolean }>;
```

**Step 4: 验证** — `npm run renderer:typecheck && npm run desktop:test`（desktop 测试不覆盖新 handler，仅确保主进程可加载）。

**Step 5: Commit**

```bash
git add apps/desktop/src/main.cjs apps/desktop/src/preload.cjs apps/renderer/src/env.d.ts
git commit -m "feat(desktop): 打开文件与在文件夹中显示 IPC"
```

---

### Task P2: 类型 + API + store + i18n

**Files:**
- Modify: `packages/shared/src/types.ts`（`WorkingPaperFormat` / `WorkingPaperManifest`）
- Modify: `apps/renderer/src/lib/api.ts`（`listWorkingPapers` / `exportWorkingPaper`）
- Create: `apps/renderer/src/store/workingPaper.ts`
- Modify: `packages/shared/src/locales/{zh-CN,en-US}.ts`（`working-paper` 命名空间扩充 + `error` 新 key）

**Step 1: 类型（`types.ts`）**

```ts
export type WorkingPaperFormat = 'word' | 'xlsx' | 'pdf';

export interface WorkingPaperManifest {
  id: string;
  createdAt: string;
  format: WorkingPaperFormat;
  locale: string;
  templateId: string;
  findingIds: string[];
  artifactRef: string;
  files: string[];
}
```

**Step 2: API（`lib/api.ts`）**

```ts
export function listWorkingPapers(): Promise<{ items: WorkingPaperManifest[] }> {
  return request<{ items: WorkingPaperManifest[] }>('/export/working-paper');
}

export interface ExportInput {
  format: WorkingPaperFormat;
  locale?: string;
  findingIds?: string[];
}

export function exportWorkingPaper(input: ExportInput): Promise<WorkingPaperManifest> {
  return request<WorkingPaperManifest>('/export/working-paper', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
```

（`WorkingPaperFormat` / `WorkingPaperManifest` 加入顶部 `@fireeyeaud/shared` 类型导入。）

**Step 3: store（`store/workingPaper.ts`）**

```ts
import { create } from 'zustand';
import type { WorkingPaperFormat, WorkingPaperManifest } from '@fireeyeaud/shared';
import { exportWorkingPaper, listWorkingPapers } from '../lib/api';

interface WorkingPaperState {
  items: WorkingPaperManifest[];
  loading: boolean;
  busy: boolean;
  errorKey: string | null;
  load: () => Promise<void>;
  generate: (format: WorkingPaperFormat, findingIds?: string[]) => Promise<boolean>;
}

export const useWorkingPaperStore = create<WorkingPaperState>((set, get) => ({
  items: [],
  loading: false,
  busy: false,
  errorKey: null,
  load: async () => {
    set({ loading: true, errorKey: null });
    try {
      const { items } = await listWorkingPapers();
      set({ items, loading: false });
    } catch (err) {
      set({ loading: false, errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
    }
  },
  generate: async (format, findingIds) => {
    set({ busy: true, errorKey: null });
    try {
      await exportWorkingPaper({ format, findingIds });
      set({ busy: false });
      await get().load();
      return true;
    } catch (err) {
      set({ busy: false, errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
      return false;
    }
  },
}));
```

**Step 4: i18n**

`working-paper`（zh-CN）：

```ts
  'working-paper': {
    title: '底稿预览',
    exportWord: '导出 Word',
    exportExcel: '导出 Excel',
    exportPdf: '导出 PDF',
    exportSelected: '仅导出选中疑点',
    exportAll: '导出全部疑点',
    generating: '生成中…',
    history: '历史底稿',
    empty: '暂无底稿，点击上方按钮生成',
    openFile: '打开文件',
    showInFolder: '在文件夹中显示',
    findingsCount: '{{count}} 条疑点',
    format: { word: 'Word', xlsx: 'Excel', pdf: 'PDF' },
  },
```

`working-paper`（en-US）：

```ts
  'working-paper': {
    title: 'Working paper',
    exportWord: 'Export Word',
    exportExcel: 'Export Excel',
    exportPdf: 'Export PDF',
    exportSelected: 'Export selected',
    exportAll: 'Export all',
    generating: 'Generating…',
    history: 'History',
    empty: 'No working papers yet',
    openFile: 'Open file',
    showInFolder: 'Show in folder',
    findingsCount: '{{count}} findings',
    format: { word: 'Word', xlsx: 'Excel', pdf: 'PDF' },
  },
```

`error`（两语言追加）：`exportFormat` / `exportEmpty`（zh：导出格式不支持 / 无可导出疑点；en：Unsupported export format / Nothing to export）。

**Step 5: 验证** — `npm run renderer:typecheck`

**Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/locales/zh-CN.ts packages/shared/src/locales/en-US.ts apps/renderer/src/lib/api.ts apps/renderer/src/store/workingPaper.ts
git commit -m "feat(renderer): 底稿导出类型、API 与 store"
```

---

### Task P3: WorkingPaperView 组件 + 接入成果栏

**Files:**
- Create: `apps/renderer/src/components/WorkingPaperView.tsx`
- Modify: `apps/renderer/src/components/ResultsColumn.tsx`
- Modify: `apps/renderer/src/styles/global.css`

**Step 1: 实现 `WorkingPaperView.tsx`**

要点：
- `useEffect(load, [load, workspacePath])`。
- 顶部工具条：三个导出按钮（Word/Excel/PDF），`busy` 时禁用并显示 `generating`；若 `selectedFindingId` 非空，额外提供「仅导出选中疑点」。
- 历史列表：每项显示 `id`、`format`、`createdAt`、`findingsCount`，行内按钮「打开文件」「在文件夹中显示」。
- 绝对路径组装：`abs(ref, file) = [wsPath, '.fireeye', 'artifacts', ref, file].join('/')`（`wsPath` 来自 `useWorkspaceStore`，Windows 下 `/` 也可被 Electron shell 处理）。
- 无工作区 → `common:noWorkspace`；空列表 → `empty`。

```tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, FolderOpen } from 'lucide-react';
import type { WorkingPaperFormat } from '@fireeyeaud/shared';
import { useWorkingPaperStore } from '../store/workingPaper';
import { useWorkspaceStore } from '../store/workspace';
import { useUiStore } from '../store/ui';

const FORMATS: WorkingPaperFormat[] = ['word', 'xlsx', 'pdf'];

export function WorkingPaperView() {
  const { t } = useTranslation('working-paper');
  const { t: tc } = useTranslation('common');
  const { t: te } = useTranslation('error');
  const items = useWorkingPaperStore((s) => s.items);
  const loading = useWorkingPaperStore((s) => s.loading);
  const busy = useWorkingPaperStore((s) => s.busy);
  const errorKey = useWorkingPaperStore((s) => s.errorKey);
  const load = useWorkingPaperStore((s) => s.load);
  const generate = useWorkingPaperStore((s) => s.generate);
  const path = useWorkspaceStore((s) => s.path);
  const selectedFindingId = useUiStore((s) => s.selectedFindingId);

  useEffect(() => {
    if (path) void load();
  }, [load, path]);

  const abs = (ref: string, file: string) =>
    [path, '.fireeye', 'artifacts', ref, file].join('/');

  const run = (format: WorkingPaperFormat, onlySelected: boolean) =>
    void generate(format, onlySelected && selectedFindingId ? [selectedFindingId] : undefined);

  if (!path) {
    return <div className="panel-empty"><span>{tc('noWorkspace')}</span></div>;
  }

  return (
    <div className="wp-wrap">
      <div className="wp-toolbar">
        {FORMATS.map((f) => (
          <button key={f} type="button" className="button button--sm" disabled={busy}
            onClick={() => run(f, false)}>
            <FileText size={12} strokeWidth={2} /> {t(`export${f === 'word' ? 'Word' : f === 'xlsx' ? 'Excel' : 'Pdf'}`)}
          </button>
        ))}
        {selectedFindingId && (
          <button type="button" className="button button--sm button--ghost" disabled={busy}
            onClick={() => run('word', true)}>
            {t('exportSelected')}
          </button>
        )}
        {busy && <span className="wp-hint">{t('generating')}</span>}
      </div>

      {errorKey && <div className="panel-error">{te(errorKey.replace(/^error\./, ''))}</div>}

      <div className="wp-history__title">{t('history')}</div>
      {loading && items.length === 0 ? (
        <div className="panel-empty"><span>{tc('loading')}</span></div>
      ) : items.length === 0 ? (
        <div className="panel-empty"><span>{t('empty')}</span></div>
      ) : (
        <div className="wp-list">
          {items.map((m) => (
            <div key={m.id} className="wp-item">
              <span className="wp-item__id">{m.id}</span>
              <span className="scope-badge">{t(`format.${m.format}`)}</span>
              <span className="wp-item__meta">
                {m.createdAt.slice(0, 19).replace('T', ' ')} · {t('findingsCount', { count: m.findingIds.length })}
              </span>
              <span className="spacer" />
              <button type="button" className="button button--sm"
                onClick={() => void window.fireeyeaud?.openPath(abs(m.artifactRef, m.files[0] ?? ''))}>
                {t('openFile')}
              </button>
              <button type="button" className="button button--sm button--ghost"
                onClick={() => void window.fireeyeaud?.showItemInFolder(abs(m.artifactRef, m.files[0] ?? ''))}>
                <FolderOpen size={12} strokeWidth={2} /> {t('showInFolder')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: `ResultsColumn.tsx` 接入**

```tsx
import { WorkingPaperView } from './WorkingPaperView';
...
        {resultsTab === 'findings' ? (
          <FindingsView />
        ) : resultsTab === 'graph' ? (
          <GraphView />
        ) : resultsTab === 'working-paper' ? (
          <WorkingPaperView />
        ) : (
          <EmptyView />
        )}
```

**Step 3: CSS（`global.css`）**

```css
.wp-wrap { display: flex; flex-direction: column; gap: 10px; }
.wp-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.wp-hint { font-size: 11px; color: var(--text-3); }
.wp-history__title { font-size: 11px; color: var(--text-3); margin-top: 4px; }
.wp-list { display: flex; flex-direction: column; gap: 6px; }
.wp-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--editor-bg); border: 1px solid var(--border); border-radius: 6px; }
.wp-item__id { font-family: var(--font-mono); font-size: 12px; color: var(--text-1); }
.wp-item__meta { font-size: 11px; color: var(--text-3); }
```

**Step 4: 验证**

Run: `npm run renderer:typecheck && npm run renderer:build && npm run desktop:test`
Expected: 全部通过

**Step 5: Commit**

```bash
git add apps/renderer/src/components/WorkingPaperView.tsx apps/renderer/src/components/ResultsColumn.tsx apps/renderer/src/styles/global.css
git commit -m "feat(renderer): 底稿预览与导出（Word/Excel/PDF）"
```

---

## 里程碑 Q — 端到端验收

### Task Q1: 验收与文档

**Step 1: 后端全量测试** — `cd services/agent && uv run pytest` → 全绿。

**Step 2: 前端检查** — `npm run renderer:typecheck && npm run renderer:build && npm run desktop:test` → 全绿。

**Step 3: 手动 E2E（需 GUI，无需模型）**

1. `npm run desktop:dev`；打开含工作区、导入或手工造几条疑点（或先用规则库批量运行）；
2. 成果栏切「底稿预览」→ 依次导出 Word / Excel / PDF；
3. 每项点「打开文件」用系统默认程序打开；点「在文件夹中显示」定位到 `.fireeye/artifacts/working-paper/<id>/`；
4. 确认 docx/xlsx 结构含封面/结论/疑点汇总/证据索引；pdf 中文正常；
5. 重开应用后历史列表仍在。

**Step 4: 更新 README / 计划文档偏差**

README 状态段追加 Phase 4；本计划末尾追加「Phase 4 实现记录」。

**Step 5: Commit**

```bash
git add -A
git commit -m "docs: Phase 4 验收记录与偏差说明"
```

---

## 风险与注意事项

- **reportlab CJK**：`UnicodeCIDFont('STSong-Light')` 依赖 reportlab 内置 CMap 资源，无需外部字体；若某环境缺失再降级为 Helvetica（英文可用，中文缺字）。测试仅断言 `%PDF-` 头与文件非空。
- **Windows 路径**：前端用 `/` 拼接绝对路径交给 Electron `shell`，Node/Electron 可正确处理；避免在渲染层依赖 `path` 模块（sandbox 无 Node）。
- **目录穿越**：`GET /artifacts/{path:path}` 必须 `resolve()` 后校验仍在 artifacts 根内。
- **空列表/无工作区**：`GET /export/working-paper` 无工作区返回 `{"items": []}`；`POST` 无工作区返回 400 `E_NO_WORKSPACE`。
- **计数并发**：`next_counter` 非原子；本地单用户场景接受。
- **deviation**：产物目录用 `wp_<n>` 而非设计示例的 `<ts>`；模板仅内置默认，不读 `.fireeye/templates/`。

---

## Phase 4 实现记录（2026-10-09 完成）

里程碑 N–P 均已完成并逐任务提交：

- **N 后端底稿生成**：新增依赖 `python-docx`、`reportlab`（`openpyxl` 已有）；
  `store/working_paper.py` 汇总材料并生成 Word / Excel / PDF + `manifest.json`，
  `list_working_papers` 按时间倒序（次键 id）列出历史。PDF 用 `UnicodeCIDFont('STSong-Light')`，
  无外部字体依赖。
- **O 导出 REST**：`api/export.py`（`GET/POST /export/working-paper`、`GET /artifacts/{path}`，
  resolve + `parents` 校验防目录穿越）；`main.py` 注册。
- **P 前端**：Electron IPC `shell:open-path` / `shell:show-item` + preload + 渲染层类型；
  `packages/shared` 增 `WorkingPaperFormat`/`WorkingPaperManifest`；`lib/api.ts`、`store/workingPaper.ts`；
  i18n（`working-paper` 扩充 + `error.exportFormat`/`exportEmpty`）；`WorkingPaperView` 挂载
  `working-paper` tab（导出 Word/Excel/PDF、仅选中疑点、历史列表、打开文件/所在目录）+ CSS。

**验证：** 后端 `uv run pytest` → 98 passed（较 Phase 3 的 88 增 10）；`renderer:typecheck` /
`renderer:build` / `desktop:test`（2 pass）均通过。真实 GUI 流程需按 Q1 Step 3 人工验证。

**实现期间的说明：**

1. `errors.py` 无需改动——错误码为 `ApiError(...)` 调用处传入，项目无集中错误码注册表。
2. PDF 中文依赖 reportlab 内置 Adobe CJK 字体 `STSong-Light`（已单独验证可注册）；测试仅断言
   `%PDF-` 头与文件非空（不做文本抽取）。
3. `GET /artifacts/{path:path}` 无需 URL 解码特殊处理：`%2F` 场景经 resolve + `parents` 校验或
   文件不存在，两种路径均返回 404。
4. `desktop:test` 在刚新增依赖后的冷启动首跑可能超 30s 健康检查超时（导入 reportlab/pillow/lxml）；
   预热后约 2.4s 通过——非回归，属冷启动抖动。
5. 产物目录用 `wp_<n>`（4 位补零，`project.counters.workingPaper`）而非设计示例的 `<ts>`；
   模板仅内置默认结构，不读 `.fireeye/templates/`（`templateId` 参数保留占位）。

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-10-09-phase4-working-paper-export.md`. Two execution options:

**1. Subagent-Driven (this session)** — 每个 Task 派发新的 subagent，任务间审查（REQUIRED SUB-SKILL: superpowers:subagent-driven-development）。

**2. Parallel Session (separate)** — 新会话用 executing-plans（REQUIRED SUB-SKILL: superpowers:executing-plans）。

Which approach?
