# 取证单与项目报告 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用**生效模板（全局 / 本项目）**把选中的疑点生成取证单、把选中的取证单生成项目报告；生成后先预览，点保存才落盘并进入列表；取证单支持上传/替换/删除回执单；列表支持预览、下载、删除。

**Architecture:** 生成请求显式携带 `templateId` + `templateScope`，后端按作用域读取全局或项目模板，预处理成 docxtpl 可用的 Jinja 标记，再渲染到 `.fireeye/staging/<token>/`；预览返回 token 与工作区相对路径，前端用 `docx-preview` 立即显示。保存时才分配 `QZ-xxxx` / `RPT-xxxx`，写入 `.fireeye/artifacts/`，同时保存生成时的疑点/取证单快照和**原始模板快照 `template.docx`**，保证全局模板变更或删除后仍可追溯。下载走新增的 Electron「另存为」IPC。

**Tech Stack:** FastAPI + docxtpl + python-docx + pytest、React + Zustand + Ant Design + docx-preview、Electron IPC。

**Depends on:** P1（疑点多选、证据 API）、P2（模板中心、示例模板、模板 API）。

---

## 0. 范围与非目标

本计划做：

- `docxtpl` 渲染与简单模板语法预处理。
- 取证单预览 → 保存 → 列表 → 预览/下载/删除。
- 取证单回执单上传/替换/删除，落在项目根目录 `回执单/`。
- 项目报告预览 → 保存 → 列表 → 预览/下载/删除。
- Electron 文件「另存为」。
- 取证单/报告列表 UI 与生成向导。

不做：打印、在线编辑 docx、多人协同、报告章节可视化编辑。

---

## 1. 产物与清单

### 1.1 取证单

```text
.fireeye/artifacts/evidence-forms/QZ-0001/
├─ document.docx
├─ template.docx        # 生成时使用的原始模板快照
└─ manifest.json
```

### 1.2 项目报告

```text
.fireeye/artifacts/reports/RPT-0001/
├─ document.docx
├─ template.docx        # 生成时使用的原始模板快照
└─ manifest.json
```

### 1.3 暂存区

```text
.fireeye/staging/<token>/
├─ payload.json       # kind / findingIds / formIds / header / templateId / templateScope
├─ template.docx      # 上传的原始模板快照
├─ prepared.docx      # 预处理后的模板，仅供本次渲染
└─ document.docx      # 渲染结果，供预览与保存
```

`payload.json` 含 `createdAt`；超过 24 小时的暂存目录在下次 preview 时清理。保存时只把 `document.docx` 和原始 `template.docx` 复制到产物目录，`prepared.docx` 留在暂存区随后删除。

### 1.4 回执单

```text
回执单/QZ-0001_客户签收.pdf
```

文件名规则：`<取证单编号>_<原文件名>`；同名时先删旧文件再写入（替换语义）。回执单在项目根目录，Agent 用普通文件工具即可感知。

---

## 2. 模板语法到 docxtpl 的映射

P2 已定义用户语法。本计划实现 `services/agent/src/fireeyeaud_agent/store/docx_render.py`。

### 2.1 字段

- 顶层：`{{项目名称}}` 保持原样，渲染上下文直接使用中文键。
- 循环内：`{{疑点.标题}}` → `{{ finding["标题"] }}`；`{{取证单.标题}}` → `{{ form["标题"] }}`。

> Jinja2 允许中文标识符，顶层中文键可直接使用；循环字段统一改写为 ASCII 变量，避免 `item.字段` 的歧义。

### 2.2 循环

- 段落标记 `{{#疑点}}` / `{{/疑点}}` → `{%p for finding in findings %}` / `{%p endfor %}`。
- 表格行标记 → `{%tr for finding in findings %}` / `{%tr endfor %}`。
- `{{#取证单}}` / `{{/取证单}}` → `{%p|tr for form in forms %}` / `{%p|tr endfor %}`。
- 报告模板允许顶层 `疑点` 循环（附录明细）；**不支持**在 `取证单` 循环内再嵌套 `疑点` 循环。报告中的每份取证单用 `{{取证单.疑点摘要}}` 展示摘要。

### 2.3 预处理实现

```python
def prepare_template(src: Path, dst: Path, kind: str) -> None:
    doc = Document(src)
    _process_paragraphs(doc.paragraphs, kind)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                _process_paragraphs(cell.paragraphs, kind)
    for section in doc.sections:
        _process_paragraphs(section.header.paragraphs, kind)
        _process_paragraphs(section.footer.paragraphs, kind)
    doc.save(dst)
```

`_process_paragraphs`：

1. 合并段落 runs 文本，匹配 `^\s*\{\{#\s*(\S+?)\s*\}\}\s*$`。
2. 根据段落是否在表格单元格（`p._p.getparent().tag.endswith('tc')`）选择 `{%tr` 或 `{%p`。
3. 结束标记同理。
4. 普通段落：`replace_in_paragraph` 替换 `{{X.Y}}` 与 `{{标签}}`。
5. 每个段落只保留一个 run 的文本，其它 run 清空；这会牺牲标记段落的局部格式，但不影响数据行其它单元格。

> 重要：数据行第一格放 `{{#疑点}}`，同一行其余单元格放 `{{疑点.*}}`；结束标记单独放下一行第一格。这是唯一保证表格行重复的写法。

---

## 3. 关键文件

后端：

- `services/agent/pyproject.toml`（新增 `docxtpl`）
- `services/agent/src/fireeyeaud_agent/store/docx_render.py`（新建）
- `services/agent/src/fireeyeaud_agent/store/evidence_forms.py`（新建）
- `services/agent/src/fireeyeaud_agent/store/reports.py`（新建）
- `services/agent/src/fireeyeaud_agent/api/evidence_forms.py`（新建）
- `services/agent/src/fireeyeaud_agent/api/reports.py`（新建）
- `services/agent/src/fireeyeaud_agent/main.py`
- `services/agent/src/fireeyeaud_agent/store/project.py`
- `services/agent/src/fireeyeaud_agent/store/workspace.py`
- `services/agent/tests/test_docx_render.py`（新建）
- `services/agent/tests/test_evidence_forms.py`（新建）
- `services/agent/tests/test_reports.py`（新建）

共享与前端：

- `packages/shared/src/types.ts`
- `packages/shared/src/locales/zh-CN.ts`
- `packages/shared/src/locales/en-US.ts`
- `apps/renderer/src/lib/api.ts`
- `apps/renderer/src/store/forms.ts`（新建）
- `apps/renderer/src/store/reports.ts`（新建）
- `apps/renderer/src/components/results/EvidenceFormsView.tsx`
- `apps/renderer/src/components/results/ReportsView.tsx`
- `apps/renderer/src/components/artifacts/GenerateFormDialog.tsx`（新建）
- `apps/renderer/src/components/artifacts/GenerateReportDialog.tsx`（新建）
- `apps/renderer/src/components/artifacts/GeneratedDocPreview.tsx`（新建）
- `apps/renderer/src/components/artifacts/ReceiptDialog.tsx`（新建）
- `apps/renderer/src/env.d.ts`
- `apps/desktop/src/main.cjs`
- `apps/desktop/src/preload.cjs`
- `apps/renderer/src/styles/global.css`

---

## Task 1: 依赖、计数器与共享类型

**Files:**
- Modify: `services/agent/pyproject.toml`
- Modify: `services/agent/src/fireeyeaud_agent/store/project.py`
- Modify: `services/agent/src/fireeyeaud_agent/store/workspace.py`
- Modify: `packages/shared/src/types.ts`

**Step 1: 安装依赖**

Run: `cd services/agent && uv add docxtpl`

Expected: `pyproject.toml` 增加 `docxtpl`，`uv.lock` 更新。

**Step 2: 计数器**

`project.py` 默认 counters 增加：

```python
"evidenceForm": 0,
"report": 0,
```

`workspace.py` 的 `_COUNTERS` 同步增加。

**Step 3: 共享类型**

```ts
export interface FindingSnapshot {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  subjects: string[];
  amount: string | null;
  currency: string;
  evidence: string[];
}

export interface ReceiptInfo {
  path: string;
  name: string;
  uploadedAt: string;
}

export interface EvidenceFormManifest {
  id: string;
  kind: 'evidence-form';
  title: string;
  templateId: string;
  /** 生成时使用的模板作用域；全局模板不随项目归档。 */
  templateScope: ConfigScope;
  templateName: string;
  createdAt: string;
  createdBy: string;
  header: Record<string, string>;
  findingIds: string[];
  findingsSnapshot: FindingSnapshot[];
  evidenceIds: string[];
  receipt: ReceiptInfo | null;
  artifactRef: string;
  /** document.docx + 原始模板快照 template.docx。 */
  files: string[];
}

export interface ReportManifest {
  id: string;
  kind: 'report';
  title: string;
  templateId: string;
  templateScope: ConfigScope;
  templateName: string;
  createdAt: string;
  createdBy: string;
  header: Record<string, string>;
  formIds: string[];
  formsSnapshot: Array<{
    id: string;
    title: string;
    createdAt: string;
    findingCount: number;
    receipt: ReceiptInfo | null;
    findings: FindingSnapshot[];
  }>;
  findingCount: number;
  artifactRef: string;
  files: string[];
}

export interface ArtifactPreview {
  token: string;
  kind: 'evidence-form' | 'report';
  fileName: string;
  /** 工作区相对路径，POSIX 分隔符。 */
  relPath: string;
  suggestedTitle: string;
  warnings: string[];
}
```

**Step 4: 类型检查**

Run: `npm run renderer:typecheck`

Expected: 仅因尚未使用新类型而通过。

**Step 5: Commit**

```bash
git add services/agent/pyproject.toml services/agent/uv.lock services/agent/src/fireeyeaud_agent/store/project.py services/agent/src/fireeyeaud_agent/store/workspace.py packages/shared/src/types.ts
git commit -m "feat(artifacts): add docxtpl counters and manifest types"
```

---

## Task 2: 模板预处理与渲染

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/docx_render.py`
- Test: `services/agent/tests/test_docx_render.py`

**Step 1: 写失败测试**

```python
from pathlib import Path

from docx import Document

from fireeyeaud_agent.store.docx_render import prepare_template, render_docx


def _template(path: Path) -> Path:
    doc = Document()
    doc.add_paragraph("项目：{{项目名称}}")
    doc.add_paragraph("取证单：{{取证单编号}}")
    table = doc.add_table(rows=3, cols=2)
    table.cell(0, 0).text = "编号"
    table.cell(0, 1).text = "标题"
    table.cell(1, 0).text = "{{#疑点}}"
    table.cell(1, 1).text = "{{疑点.编号}} {{疑点.标题}}"
    table.cell(2, 0).text = "{{/疑点}}"
    doc.save(path)
    return path


def test_prepare_and_render(tmp_path):
    src = _template(tmp_path / "tpl.docx")
    prepared = tmp_path / "prepared.docx"
    out = tmp_path / "out.docx"
    prepare_template(src, prepared, "evidence-form")

    render_docx(
        prepared,
        out,
        {
            "项目名称": "年报审计",
            "取证单编号": "QZ-0001",
            "findings": [
                {"编号": "F-0001", "标题": "关联方交易"},
                {"编号": "F-0002", "标题": "收入截止"},
            ],
        },
    )

    text = "\n".join(p.text for p in Document(out).paragraphs)
    assert "年报审计" in text
    table_text = "\n".join(
        cell.text for table in Document(out).tables for row in table.rows for cell in row.cells
    )
    assert "F-0001" in table_text
    assert "F-0002" in table_text
    assert "关联方交易" in table_text
```

**Step 2: 运行确认失败**

Run: `npm run agent:test -- tests/test_docx_render.py -q`

Expected: `ModuleNotFoundError`。

**Step 3: 实现**

`docx_render.py` 关键点：

```python
_LOOP_START = re.compile(r"^\s*\{\{#\s*([^{}]+?)\s*\}\}\s*$")
_LOOP_END = re.compile(r"^\s*\{\{/\s*([^{}]+?)\s*\}\}\s*$")
LOOP_VARS = {
    "疑点": ("finding", "findings"),
    "取证单": ("form", "forms"),
}
```

`replace_in_paragraph(paragraph, old, new)`：

```python
text = "".join(run.text for run in paragraph.runs)
if old not in text:
    return
new_text = text.replace(old, new)
if not paragraph.runs:
    paragraph.add_run(new_text)
    return
paragraph.runs[0].text = new_text
for run in paragraph.runs[1:]:
    run.text = ""
```

循环标记：

```python
m = _LOOP_START.match(text)
if m:
    name = m.group(1).strip()
    var, coll = LOOP_VARS[name]
    in_cell = paragraph._p.getparent().tag.endswith("tc")
    tag = "tr" if in_cell else "p"
    replace_in_paragraph(paragraph, text, "{%" + tag + f" for {var} in {coll} %"})
    return
```

`prepare_template` 之后：

```python
for name, (var, _coll) in LOOP_VARS.items():
    replace_in_paragraph(paragraph, "{{" + name + ".", "{{ " + var + "[\"")
```

但这样右括号不匹配。更稳的是正则替换整段：

```python
FIELD_IN_LOOP = {
    "疑点": re.compile(r"\{\{\s*疑点\.([^{}]+?)\s*\}\}"),
    "取证单": re.compile(r"\{\{\s*取证单\.([^{}]+?)\s*\}\}"),
}
new_text = pattern.sub(lambda m: '{{ ' + var + '["' + m.group(1) + '"] }}', text)
```

`render_docx`：

```python
from docxtpl import DocxTemplate

def render_docx(template: Path, out: Path, context: dict) -> None:
    tpl = DocxTemplate(str(template))
    tpl.render(context)
    out.parent.mkdir(parents=True, exist_ok=True)
    tpl.save(str(out))
```

**Step 4: 运行测试**

Run: `npm run agent:test -- tests/test_docx_render.py -q`

Expected: PASS。

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/docx_render.py services/agent/tests/test_docx_render.py
git commit -m "feat(artifacts): preprocess docx templates and render with docxtpl"
```

---

## Task 3: 取证单上下文、预览与保存

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/evidence_forms.py`
- Test: `services/agent/tests/test_evidence_forms.py`

**Step 1: 写失败测试**

```python
from pathlib import Path

from docx import Document

from fireeyeaud_agent.store.evidence_forms import (
    commit_evidence_form,
    list_evidence_forms,
    preview_evidence_form,
)
from fireeyeaud_agent.store.findings import create_finding
from fireeyeaud_agent.store.templates import upload_template


def _setup(tmp_path: Path, monkeypatch) -> tuple[str, str]:
    # 模板元数据走全局配置计数器；测试必须隔离全局目录。
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    fid = create_finding(
        tmp_path,
        title="关联方交易",
        description="未披露",
        severity="high",
        dataRefs=[],
        sessionId="",
        origin="manual",
    )["id"]
    doc = Document()
    doc.add_paragraph("{{项目名称}}")
    doc.add_paragraph("{{取证单编号}}")
    table = doc.add_table(rows=3, cols=2)
    table.cell(0, 0).text = "编号"
    table.cell(0, 1).text = "标题"
    table.cell(1, 0).text = "{{#疑点}}"
    table.cell(1, 1).text = "{{疑点.编号}} {{疑点.标题}}"
    table.cell(2, 0).text = "{{/疑点}}"
    src = tmp_path / "tpl.docx"
    doc.save(src)
    tpl = upload_template(tmp_path, src, kind="evidence-form", scope="project")
    return fid, tpl["id"]


def test_preview_and_commit(tmp_path, monkeypatch):
    fid, tpl_id = _setup(tmp_path, monkeypatch)
    preview = preview_evidence_form(
        tmp_path,
        template_id=tpl_id,
        template_scope="project",
        finding_ids=[fid],
        header={"projectName": "年报审计", "preparedBy": "张审计"},
    )
    assert (tmp_path / preview["relPath"]).is_file()
    assert preview["suggestedTitle"]

    manifest = commit_evidence_form(tmp_path, preview["token"], title="关联方取证单")
    assert manifest["id"] == "QZ-0001"
    assert manifest["templateScope"] == "project"
    assert manifest["findingIds"] == [fid]
    artifact = tmp_path / ".fireeye" / "artifacts" / "evidence-forms" / "QZ-0001"
    assert (artifact / "document.docx").is_file()
    assert (artifact / "template.docx").is_file()
    assert list_evidence_forms(tmp_path)[0]["id"] == "QZ-0001"
```

**Step 2: 运行确认失败**

Run: `npm run agent:test -- tests/test_evidence_forms.py -q`

Expected: `ModuleNotFoundError`。

**Step 3: 实现**

目录与辅助：

```python
def forms_dir(root: Path) -> Path:
    return Path(root) / ".fireeye" / "artifacts" / "evidence-forms"

def staging_dir(root: Path) -> Path:
    return Path(root) / ".fireeye" / "staging"

def receipts_dir(root: Path) -> Path:
    return Path(root) / "回执单"
```

`_finding_snapshot(finding, evidence_by_id)`：

```python
{
  "id": finding["id"],
  "title": (finding.get("title") or {}).get("text") or finding.get("ruleKey") or finding["id"],
  "description": (finding.get("description") or {}).get("text") or "",
  "severity": finding.get("severity"),
  "status": finding.get("status"),
  "subjects": finding.get("subjects") or [],
  "amount": finding.get("amount"),
  "currency": finding.get("currency") or "CNY",
  "evidence": [
    e.get("title") or e.get("resultSummary") or e.get("filePath") or e["id"]
    for e in (evidence_by_id.get(ref) for ref in finding.get("evidenceRefs") or [])
    if e
  ],
}
```

`_form_context(header, snapshots)`：

```python
{
  "项目名称": header.get("projectName") or "",
  "项目编号": header.get("projectCode") or "",
  "被审计单位": header.get("auditee") or "",
  "审计期间": header.get("period") or "",
  "编制人": header.get("preparedBy") or "",
  "复核人": header.get("reviewedBy") or "",
  "日期": header.get("date") or today,
  "取证单编号": header.get("formNo") or "（保存时生成）",
  "取证单标题": header.get("formTitle") or "",
  "疑点数量": len(snapshots),
  "findings": [
    {
      "编号": s["id"],
      "标题": s["title"],
      "描述": s["description"],
      "风险": _severity_label(s["severity"]),
      "状态": _status_label(s["status"]),
      "科目": "、".join(s["subjects"]),
      "金额": f'{s["amount"]} {s["currency"]}' if s["amount"] else "",
      "证据": "；".join(s["evidence"]),
      "证据数量": len(s["evidence"]),
    }
    for s in snapshots
  ],
}
```

`preview_evidence_form`：

1. 校验 `finding_ids` 非空、模板存在且 `kind == "evidence-form"`、全部疑点存在且未删除。
2. 用 `templates_store.resolve_template(root, template_id, template_scope)` 解析模板；显式作用域找不到时 404，不静默跨作用域回退。
3. `token = uuid4().hex`；建 `staging/<token>`。
4. 复制原始模板到 `staging/<token>/template.docx`；`prepare_template(template.docx, prepared.docx, "evidence-form")`。
5. `render_docx(prepared.docx, document.docx, context)`。
6. 写 `payload.json`：`kind/templateId/templateScope/templateName/header/findingIds/evidenceIds/createdAt`。
7. 返回 `{token, kind, fileName: "取证单.docx", relPath: f".fireeye/staging/{token}/document.docx", suggestedTitle, warnings}`。
8. `warnings` 来自模板 `check.unknown/missing`，以及 `finding.evidenceRefs` 为空时的提示。

`commit_evidence_form`：

1. 读 payload，校验 24 小时内。
2. `next_counter(fe, "evidenceForm", root)` → `QZ-0001`。
3. 建目标目录，复制 `document.docx` 与 `template.docx`，删除 staging。
4. 构造 manifest（含 `templateId/templateScope/templateName`），写 `manifest.json`（`write_json_atomic`）。
5. 返回 manifest。

`list_evidence_forms`：遍历 `forms_dir` 下 `*/manifest.json`，按 `createdAt` 倒序；忽略损坏项。

`delete_evidence_form`：删除整个目录；若 manifest 有回执，删 `回执单/` 下的文件。

**Step 4: 运行测试**

Run: `npm run agent:test -- tests/test_evidence_forms.py -q`

Expected: PASS。

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/evidence_forms.py services/agent/tests/test_evidence_forms.py
git commit -m "feat(forms): render preview and persist evidence forms"
```

---

## Task 4: 回执单

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/evidence_forms.py`
- Test: `services/agent/tests/test_evidence_forms.py`

**Step 1: 写失败测试**

```python
def test_receipt_upload_replace_delete(tmp_path, monkeypatch):
    fid, tpl_id = _setup(tmp_path, monkeypatch)
    preview = preview_evidence_form(
        tmp_path,
        template_id=tpl_id,
        template_scope="project",
        finding_ids=[fid],
        header={"projectName": "P"},
    )
    manifest = commit_evidence_form(tmp_path, preview["token"], title="取证单")
    form_id = manifest["id"]

    a = tmp_path / "客户签收.pdf"
    a.write_bytes(b"%PDF a")
    updated = attach_receipt(tmp_path, form_id, a)
    assert updated["receipt"]["name"] == "客户签收.pdf"
    assert (tmp_path / "回执单" / f"{form_id}_客户签收.pdf").is_file()

    b = tmp_path / "客户签收2.pdf"
    b.write_bytes(b"%PDF b")
    updated = attach_receipt(tmp_path, form_id, b)
    assert updated["receipt"]["name"] == "客户签收2.pdf"
    assert not (tmp_path / "回执单" / f"{form_id}_客户签收.pdf").exists()

    assert clear_receipt(tmp_path, form_id)["receipt"] is None
```

**Step 2: 实现**

```python
RECEIPT_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".docx"}
RECEIPT_MAX = 20 * 1024 * 1024
```

`attach_receipt`：

1. 读取 manifest；不存在 404。
2. 校验后缀/大小。
3. 若已有回执，先删除旧文件。
4. `target = receipts_dir / f"{form_id}_{source.name}"`；`shutil.copy2`。
5. 更新 manifest `receipt = {path: "回执单/<name>", name, uploadedAt}`。
6. 原子写回。

`clear_receipt`：删除文件并置 `None`。

**Step 3: 运行测试**

Run: `npm run agent:test -- tests/test_evidence_forms.py -q`

Expected: PASS。

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/evidence_forms.py services/agent/tests/test_evidence_forms.py
git commit -m "feat(forms): attach replace and clear receipts"
```

---

## Task 5: 项目报告

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/reports.py`
- Test: `services/agent/tests/test_reports.py`

**Step 1: 写失败测试**

```python
def test_report_preview_and_commit(tmp_path):
    # 复用 test_evidence_forms 的 _setup 生成一份取证单
    ...
    preview = preview_report(
        tmp_path,
        template_id=report_tpl_id,
        template_scope="project",
        form_ids=[form_id],
        header={"projectName": "年报审计"},
    )
    manifest = commit_report(tmp_path, preview["token"], title="项目报告")
    assert manifest["id"] == "RPT-0001"
    assert manifest["formIds"] == [form_id]
    assert manifest["findingCount"] == 1
```

**Step 2: 实现**

- `build_report_context`：
  - 读取每个 `form_id` 的 manifest；按传入顺序。
  - `forms` 列表字段：`编号/标题/日期/疑点数量/回执/疑点摘要/编制人`。
  - `findings` 用所有 `findingsSnapshot` 展平去重（按 id）。
  - 顶层字段：`报告编号`（占位）、`报告标题`、`取证单数量`、`疑点数量`。
- `preview_report` 与 `preview_evidence_form` 同构，kind 为 `report`；同样接收 `template_id` + `template_scope`，复制原始模板快照到暂存区。
- `commit_report`：
  - `next_counter(fe, "report", root)` → `RPT-0001`。
  - 复制 `document.docx` 与 `template.docx`，`files` 记录两者。
  - 写 `formsSnapshot`（从 manifest 读，不读实时疑点）。
  - 写 `templateId/templateScope/templateName` 与 `manifest.json`。
- `list_reports` / `delete_report` 同取证单。

> 报告保存后不再依赖取证单文件；即使取证单被删除，报告仍可预览和追溯（`formsSnapshot` 已保存）。

**Step 3: 运行测试**

Run: `npm run agent:test -- tests/test_reports.py -q`

Expected: PASS。

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/reports.py services/agent/tests/test_reports.py
git commit -m "feat(reports): render and persist combined project reports"
```

---

## Task 6: API 路由

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/api/evidence_forms.py`
- Create: `services/agent/src/fireeyeaud_agent/api/reports.py`
- Modify: `services/agent/src/fireeyeaud_agent/main.py`
- Test: `services/agent/tests/test_evidence_forms_api.py`（新建）

**Step 1: 路由**

取证单：

```python
class PreviewBody(BaseModel):
    templateId: str
    templateScope: Literal["global", "project"]
    findingIds: list[str]
    header: dict[str, str] = {}

class CommitBody(BaseModel):
    token: str
    title: str | None = None

class ReceiptBody(BaseModel):
    path: str

@router.post("/evidence-forms/preview")
def preview(body: PreviewBody) -> dict: ...

@router.post("/evidence-forms", status_code=201)
def commit(body: CommitBody) -> dict: ...

@router.get("/evidence-forms")
def list_all() -> dict: ...

@router.get("/evidence-forms/{form_id}")
def get_one(form_id: str) -> dict: ...

@router.delete("/evidence-forms/{form_id}")
def remove(form_id: str) -> dict: ...

@router.post("/evidence-forms/{form_id}/receipt")
def receipt(form_id: str, body: ReceiptBody) -> dict: ...

@router.delete("/evidence-forms/{form_id}/receipt")
def clear(form_id: str) -> dict: ...
```

报告同构。

**Step 2: 注册**

`main.py` 导入并 `include_router` 两个新 router。

**Step 3: API 测试**

覆盖：preview → commit → list → receipt → delete；report 同理。测试用 `httpx.ASGITransport` 与现有风格一致。

Run: `npm run agent:test -- tests/test_evidence_forms_api.py -q`

Expected: PASS。

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/api services/agent/src/fireeyeaud_agent/main.py services/agent/tests/test_evidence_forms_api.py
git commit -m "feat(api): add evidence forms and reports routes"
```

---

## Task 7: Electron 另存为与文件选择

**Files:**
- Modify: `apps/desktop/src/main.cjs`
- Modify: `apps/desktop/src/preload.cjs`
- Modify: `apps/renderer/src/env.d.ts`

**Step 1: 新增 IPC**

`main.cjs`：

```js
ipcMain.handle('dialog:save-file', async (_event, payload) => {
  const { sourcePath, suggestedName, filters } = payload ?? {};
  if (typeof sourcePath !== 'string' || !sourcePath) return { ok: false };
  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: '保存文件',
    defaultPath: suggestedName || path.basename(sourcePath),
    filters: filters ?? [{ name: 'Word 文档', extensions: ['docx'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    fs.copyFileSync(sourcePath, result.filePath);
    return { ok: true, path: result.filePath };
  } catch {
    return { ok: false };
  }
});
```

同时在 `dialog:open-files` 增加 `kind === 'receipts'`：`pdf/png/jpg/jpeg/docx`，单选。

**Step 2: preload**

```js
saveFile: (payload) => ipcRenderer.invoke('dialog:save-file', payload),
```

**Step 3: env.d.ts**

```ts
saveFile: (payload: {
  sourcePath: string;
  suggestedName?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}) => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
```

`openFiles` kind 增加 `'templates' | 'receipts'`。

**Step 4: 测试**

Run: `npm run desktop:test`

Expected: PASS（如现有测试覆盖 IPC 列表，补充 save-file 的快照/存在性断言）。

**Step 5: Commit**

```bash
git add apps/desktop/src/main.cjs apps/desktop/src/preload.cjs apps/renderer/src/env.d.ts
git commit -m "feat(desktop): add save-as and receipt file picker"
```

---

## Task 8: 前端 API 与 Store

**Files:**
- Modify: `apps/renderer/src/lib/api.ts`
- Create: `apps/renderer/src/store/forms.ts`
- Create: `apps/renderer/src/store/reports.ts`

**Step 1: API**

```ts
import type { ConfigScope } from '@fireeyeaud/shared';

export interface GenerateFormInput {
  templateId: string;
  templateScope: ConfigScope;
  findingIds: string[];
  header: Record<string, string>;
}

export function previewEvidenceForm(input: GenerateFormInput): Promise<ArtifactPreview> {
  return request('/evidence-forms/preview', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function commitEvidenceForm(token: string, title?: string): Promise<EvidenceFormManifest> {
  return request('/evidence-forms', {
    method: 'POST',
    body: JSON.stringify({ token, title }),
  });
}

export function listEvidenceForms(): Promise<{ items: EvidenceFormManifest[] }> { ... }
export function deleteEvidenceForm(id: string): Promise<{ ok: boolean }> { ... }
export function attachReceipt(id: string, path: string): Promise<EvidenceFormManifest> { ... }
export function clearReceipt(id: string): Promise<EvidenceFormManifest> { ... }

export interface GenerateReportInput {
  templateId: string;
  templateScope: ConfigScope;
  formIds: string[];
  header: Record<string, string>;
}
export function previewReport(input: GenerateReportInput): Promise<ArtifactPreview> { ... }
export function commitReport(token: string, title?: string): Promise<ReportManifest> { ... }
export function listReports(): Promise<{ items: ReportManifest[] }> { ... }
export function deleteReport(id: string): Promise<{ ok: boolean }> { ... }
```

**Step 2: Store**

`forms.ts`：`items/loading/errorKey/load/preview/commit/remove/attachReceipt/clearReceipt/reset`。

`reports.ts`：`items/loading/errorKey/load/preview/commit/remove/reset`。

`preview` 只返回 `ArtifactPreview`，不改变列表；`commit` 后 `load()`。

**Step 3: 类型检查**

Run: `npm run renderer:typecheck`

Expected: PASS（新文件未被引用也不报错）。

**Step 4: Commit**

```bash
git add apps/renderer/src/lib/api.ts apps/renderer/src/store/forms.ts apps/renderer/src/store/reports.ts
git commit -m "feat(renderer): add forms and reports api stores"
```

---

## Task 9: 生成预览与保存弹窗

**Files:**
- Create: `apps/renderer/src/components/artifacts/GeneratedDocPreview.tsx`
- Create: `apps/renderer/src/components/artifacts/GenerateFormDialog.tsx`
- Create: `apps/renderer/src/components/artifacts/GenerateReportDialog.tsx`

**Step 1: 文档预览弹窗**

`GeneratedDocPreview` props：

```ts
{
  open: boolean;
  preview: ArtifactPreview | null;
  title: string;
  defaultTitle: string;
  onSave: (title: string) => Promise<void>;
  onCancel: () => void;
}
```

- 读取 `preview.relPath`：`window.fireeyeaud.readFile({root: wsPath, path: `${wsPath}/${relPath}`})`。
- `content.kind === 'base64'` 时渲染懒加载 `DocxPreview`。
- 显示标题输入框（默认 `preview.suggestedTitle`）。
- 按钮：取消（调用 `onCancel`，后端暂存会在 24 小时后清理）、保存（`onSave(title)`）。
- 保存成功后关闭并刷新列表。

**Step 2: 取证单生成向导**

`GenerateFormDialog`：

- 读取 `templates` store（已包含全局 + 项目合并结果），筛选 `kind === 'evidence-form'`；用 `pickDefaultTemplate` 选中默认项，项目默认优先。
- 弹窗打开或模板列表加载完成时，把当前选择初始化为 `pickDefaultTemplate` 的结果（不是空值）；这样用户直接点生成就使用默认模板。
- 顶部显示「已选 N 条疑点」；N 来自 `findings.selectedIds`。
- 模板选择项显示名称 + `ScopeBadge`；选中行下方再显示一次作用域和「默认」标记，避免同名模板混淆。
- 模板选择下方提供「设为默认模板」勾选项：用户切换到其他模板后勾选，立即调用 `templates.setDefault(id, scope)`，下次弹窗默认选中它；失败时提示并回滚勾选。
- 抬头字段：项目名称（默认 `workspace.name`）、项目编号、被审计单位、审计期间、编制人、复核人、日期（默认今天）。
- 若没有模板：提示去模板中心上传，禁用预览按钮。
- 点「生成预览」→ `previewEvidenceForm({templateId, templateScope, findingIds, header})` → 打开 `GeneratedDocPreview`。
- 保存 → `commitEvidenceForm(token, title)`；保存后列表行可显示模板名与作用域。

**Step 3: 报告生成向导**

`GenerateReportDialog`：

- 模板筛选 `kind === 'report'`，同样用 `pickDefaultTemplate` 初始化选中项并显示 `ScopeBadge`。
- 显示「已选 N 份取证单」。
- 抬头字段：项目名称、项目编号、被审计单位、审计期间、编制人、复核人、日期。
- 同样提供「设为默认模板」勾选项；预览/保存流程同上，传 `templateId + templateScope`。

**Step 4: 文案**

在 `evidence-form` 命名空间加：

```ts
generate: '生成取证单',
previewTitle: '取证单预览',
selectedFindings: '已选 {{count}} 条疑点',
noSelection: '请先在疑点中勾选至少一条',
template: '模板',
templateScope: '模板作用域',
setAsDefault: '设为默认模板',
defaultSaved: '已设为默认模板',
header: '抬头信息',
projectName: '项目名称',
projectCode: '项目编号',
auditee: '被审计单位',
period: '审计期间',
preparedBy: '编制人',
reviewedBy: '复核人',
date: '日期',
preview: '生成预览',
save: '保存',
cancel: '取消',
saved: '取证单已保存',
previewFailed: '预览失败',
title: '取证单标题',
```

`report` 命名空间同构，`selectedForms: '已选 {{count}} 份取证单'`。

**Step 5: 手测**

`npm run dev`：选 2 条疑点 → 生成取证单 → 预览能看到两条疑点 → 保存 → 列表新增一条；取消 → 列表不新增。

**Step 6: Commit**

```bash
git add apps/renderer/src/components/artifacts apps/renderer/src/styles/global.css packages/shared/src/locales
git commit -m "feat(artifacts): add generation dialogs and docx preview"
```

---

## Task 10: 取证单列表与回执

**Files:**
- Replace: `apps/renderer/src/components/results/EvidenceFormsView.tsx`
- Create: `apps/renderer/src/components/artifacts/ReceiptDialog.tsx`

**Step 1: 列表**

- 顶部工具栏：`生成取证单`（打开 `GenerateFormDialog`），显示已选疑点数。
- 行：`QZ-0001`、标题、创建时间、疑点数量、模板名 + `ScopeBadge`、回执 badge（有/无）。
- 操作：预览、下载、上传/替换回执、删除。

**Step 2: 预览与下载**

```ts
const fileName = form.files.find((f) => f === 'document.docx') ?? form.files[0];
const rel = `${form.artifactRef}/${fileName}`;
const abs = `${wsPath}/${rel}`;
```

- 预览：用 `GeneratedDocPreview` 的只读模式（不显示保存按钮），或直接打开新预览 tab：`openPreview(wsPath, abs, `${form.id}.docx`)`。推荐新 tab，复用文件预览。
- 下载：`window.fireeyeaud.saveFile({sourcePath: abs, suggestedName: `${form.id}.docx`})`。

**Step 3: 回执**

`ReceiptDialog`：

- 已有回执：显示文件名/时间，按钮「查看」「替换」「删除」。
- 上传：`window.fireeyeaud.openFiles('receipts')` → `attachReceipt(form.id, path)`。
- 删除：确认后 `clearReceipt(form.id)`。
- 查看：`openPreview(wsPath, `${wsPath}/${receipt.path}`, receipt.name)`。

**Step 4: 删除**

`Modal.confirm` 提示会同时删除回执文件；确认后 `remove(form.id)`。

**Step 5: 样式**

```css
.artifact-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.artifact-row { display: flex; align-items: center; gap: 8px; padding: 8px; border-bottom: 1px solid var(--border); }
.artifact-row__main { min-width: 0; flex: 1; }
.artifact-row__title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.artifact-row__meta { font-size: 12px; color: var(--text-muted); }
.artifact-row__actions { display: flex; gap: 4px; }
.receipt-badge { font-size: 11px; padding: 1px 5px; border-radius: 3px; background: var(--bg-subtle); }
```

**Step 6: 手测**

- 保存后立即出现在列表，刷新仍在。
- 预览/下载内容一致。
- 上传回执后文件在 `回执单/`，Agent 能通过文件工具看到。
- 替换回执旧文件被删除。
- 删除取证单后 `QZ-xxxx` 目录与回执都消失。

**Step 7: Commit**

```bash
git add apps/renderer/src/components/results/EvidenceFormsView.tsx apps/renderer/src/components/artifacts/ReceiptDialog.tsx apps/renderer/src/styles/global.css
git commit -m "feat(forms): add forms list preview download and receipts"
```

---

## Task 11: 报告列表

**Files:**
- Replace: `apps/renderer/src/components/results/ReportsView.tsx`

**Step 1: 列表**

- 顶部：`生成报告` 按钮；列表每行 checkbox，用于多选取证单。
- 行：`RPT-0001`、标题、创建时间、取证单数量、疑点数量、模板名 + `ScopeBadge`。
- 操作：预览、下载、删除。
- 生成按钮在未选取证单时禁用，并显示 `selectedForms`。

**Step 2: 预览/下载**

同取证单：`artifactRef` + `files` 中的 `document.docx`（不要假定 `files[0]`）。

**Step 3: 手测**

- 勾选 2 份取证单 → 生成报告 → 预览包含两份取证单摘要 → 保存 → 列表新增。
- 删除一份取证单后，报告仍能预览（快照）。
- 删除报告只删报告目录。

**Step 4: Commit**

```bash
git add apps/renderer/src/components/results/ReportsView.tsx
git commit -m "feat(reports): add reports list and generation flow"
```

---

## Task 12: 全量验证

Run: `npm run agent:test`

Run: `npm run renderer:typecheck`

Run: `npm run renderer:build`

Run: `npm run desktop:test`

Expected: 全部通过。

手工回归：

1. 模板缺 `{{项目名称}}` 时生成仍有提示，但文档可生成。
2. 一条疑点也可生成取证单；多选顺序与勾选顺序一致。
3. 取消预览不产生 `QZ-*` / `RPT-*` 目录。
4. 暂存目录不会出现在列表中。
5. 回执替换后旧文件不存在。
6. 下载使用系统另存为，目标文件可正常打开。
7. 用全局模板生成后删除该全局模板，产物仍可从 `template.docx` 快照预览；项目模板删除同理。
8. 同 kind 同时存在全局默认和项目默认时，生成向导默认选中项目模板；手动切成全局模板后能正常生成。
9. 在生成弹窗勾选「设为默认模板」并生成后，关闭再打开弹窗，默认选中刚勾选的模板。
10. 项目模板生成的产物在归档/还原后仍可预览；全局模板不要求存在于还原机器。

---

## 验收标准

- 勾选疑点可生成一份合并取证单，先预览后保存。
- 取证单列表可预览、下载、删除，可上传/替换/删除回执。
- 回执位于项目根目录 `回执单/`，每个取证单最多一份。
- 勾选取证单可生成一份合并项目报告，先预览后保存。
- 报告使用生成时的快照，不随疑点/取证单删除而变化。
- 模板作用域与模板中心一致：生成时显式选择全局或本项目模板，项目默认优先；清单记录 `templateScope`。
- 生成弹窗打开时默认选中默认模板；弹窗内可勾选「设为默认模板」，下次打开自动选中。
- 每个产物目录包含 `template.docx` 原始模板快照，模板变更或删除不影响既有产物预览。
- 不做打印；所有产物为 docx。
