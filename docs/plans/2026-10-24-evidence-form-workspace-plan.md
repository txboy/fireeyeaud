# 取证单写作台（仿照项目报告）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把取证单从「选模板 → 渲染一次 docx」改成「选模板 + 勾疑点 → 与模型一起写结构化正文 → 校验 → 导出 Word」，并清除旧的取证单生成链路与旧数据。

**Architecture:** 新增 `store/form_docs.py`，与 `store/report_docs.py` 共用渲染/归一化原语，按 `kind` 区分目录、编号前缀、摘要字段；`agent/form_agent.py` 复用报告代理的流式循环；前端把报告写作台的三个组件参数化后给取证单复用。旧 `store/evidence_forms.py` 收窄为「编号 + manifest 读写 + 回执 + 一次性迁移」，预览/渲染代码删除。

**Tech Stack:** Python 3.12 / FastAPI / python-docx / docxtpl / LangGraph 兼容的 LangChain 工具；React 18 / TypeScript / Zustand / Ant Design / Tiptap；pytest / node --test。

**Spec:** `docs/plans/2026-10-24-evidence-form-workspace-design.md`

## Global Constraints

- 所有新增/改动的后端代码放在 `services/agent/src/fireeyeaud_agent/`，测试放在 `services/agent/tests/`。
- 测试运行方式：`cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/<file> -q`。
- 前端类型检查：`npm run renderer:typecheck`（仓库根）。构建：`npm run renderer:build`。前端单测：`npm test`。
- 错误用 `ApiError(code, http_status, message_key, params)`；新增 messageKey 必须同步写入 `packages/shared/src/locales/zh-CN.ts` 与 `en.ts` 的 `error` 命名空间。
- 所有用户可见文案同时改 `zh-CN.ts` 与 `en.ts`；文案 key 命名沿用现有 camelCase。
- 旧目录 `.fireeye/artifacts/evidence-forms/` 在迁移后**仍然作为新写作台的产物目录**（`QZ-xxxx`），不换目录名；被清掉的是其中的**旧格式**产物。
- 编号一律 4 位补零：`QZ-0001`、`RPT-0001`；正则一律 `^QZ-\d{4,}$`。
- 模板 placeholders **不执行**：导出只按结构化正文重建正文，保留标题之前的固定内容。
- 每次提交信息用 `feat(form):` / `refactor(form):` / `test(form):` / `chore(form):` 前缀。

## Review Focus

1. **旧取证单清理误伤**：工作区里有用户已导出的报告时，清理必须只移除指向旧取证单的快照条目，不得改动其余快照或让 `findingCount` 变成负数。
2. **迁移幂等**：同一工作区重复打开不得二次删除、不得把新建的取证单当旧数据删掉。
3. **模板样式继承**：导出的 docx 必须保留模板的正文字体/字号/行距/页边距；模板里 `{{...}}` 占位段落不得出现在导出结果中。
4. **模型上下文完整性**：整份模板原文（含表格单元格与占位符）必须出现在发给模型的 system 消息里，否则模型无法「仿写」。
5. **编号复用**：清库后第一个新建取证单必须是 `QZ-0001`，且不得覆盖任何已存在目录。

---

### Task 1: 取证单存储骨架（编号 / manifest / 回收）

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/evidence_forms.py`
- Test: `services/agent/tests/test_evidence_forms.py`（整体重写）

**Interfaces:**
- Consumes: `findings.get_finding(root, finding_id)`, `lock.WORKSPACE_MUTATION_LOCK`, `project.next_counter(fe, key, root)`, `fsutil.write_json_atomic`, `util.now_iso`
- Produces:
  - `forms_dir(root: Path) -> Path`（`.fireeye/artifacts/evidence-forms`）
  - `staging_dir(root: Path) -> Path`（`.fireeye/staging`，仅为兼容报告预览保留）
  - `receipts_dir(root: Path) -> Path`（`回执单`）
  - `SEVERITY_LABEL: dict[str, str]`, `STATUS_LABEL: dict[str, str]`
  - `snapshot_finding(root: Path, finding: dict) -> dict`（返回 `FindingSnapshot` 形状）
  - `next_form_id(root: Path) -> str`（返回 `QZ-0001` 形式，绝不与已存在目录冲突）
  - `load_manifest(root, form_id) -> dict`（不存在抛 `E_NOT_FOUND`）
  - `save_manifest(root, manifest) -> None`
  - `list_evidence_forms(root) -> list[dict]`（按 `updatedAt or createdAt` 倒序）

- [ ] **Step 1: 写失败测试**

新建 `services/agent/tests/test_evidence_forms.py`：

```python
"""取证单存储：编号、manifest、列表与回执（旧渲染链路已删除）。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store import evidence_forms


def _root(tmp_path: Path) -> Path:
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)
    return root


def test_next_form_id_starts_at_one(tmp_path):
    root = _root(tmp_path)
    assert evidence_forms.next_form_id(root) == "QZ-0001"


def test_next_form_id_never_collides_with_existing_dir(tmp_path):
    root = _root(tmp_path)
    occupied = evidence_forms.forms_dir(root) / "QZ-0001"
    occupied.mkdir(parents=True)
    assert evidence_forms.next_form_id(root) == "QZ-0002"


def test_load_manifest_rejects_bad_id_and_missing(tmp_path):
    root = _root(tmp_path)
    for bad in ("../etc", "RPT-0001", "QZ-1"):
        with pytest.raises(ApiError):
            evidence_forms.load_manifest(root, bad)
    with pytest.raises(ApiError) as exc:
        evidence_forms.load_manifest(root, "QZ-9999")
    assert exc.value.code == "E_NOT_FOUND"


def test_save_and_list_manifests(tmp_path):
    root = _root(tmp_path)
    for form_id, stamp in (("QZ-0001", "2026-10-01T00:00:00+00:00"), ("QZ-0002", "2026-10-02T00:00:00+00:00")):
        directory = evidence_forms.forms_dir(root) / form_id
        directory.mkdir(parents=True)
        evidence_forms.save_manifest(
            root,
            {"id": form_id, "kind": "evidence-form", "title": form_id, "createdAt": stamp},
        )
    items = evidence_forms.list_evidence_forms(root)
    assert [item["id"] for item in items] == ["QZ-0002", "QZ-0001"]


def test_snapshot_finding_shape():
    finding = {
        "id": "F-0001",
        "title": "关联方交易",
        "description": "未披露",
        "severity": "high",
        "status": "confirmed",
        "subjects": ["其他应收款"],
        "amount": "99",
        "currency": "CNY",
        "evidenceRefs": ["E-0001"],
    }
    snap = evidence_forms.snapshot_finding(Path("."), finding)
    assert snap["id"] == "F-0001"
    assert snap["title"] == "关联方交易"
    assert snap["amount"] == "99"
    assert snap["evidence"] == ["E-0001"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_evidence_forms.py -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'next_form_id'`

- [ ] **Step 3: 实现存储骨架**

把 `store/evidence_forms.py` 整体替换为：

```python
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


def get_evidence_form(root: Path, form_id: str) -> dict[str, Any]:
    return load_manifest(root, form_id)


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
```

保留本文件末尾的回执单函数（`attach_receipt` / `clear_receipt` / `_receipt_path`），但要：
- 用 `load_manifest(root, form_id)` 取代 `get_evidence_form`（别名已保留，不必改）；
- `_save_manifest(root, manifest)` 改为 `save_manifest(root, manifest)`，删除本地 `_save_manifest`；
- 删除 `preview_evidence_form`、`commit_evidence_form`、`_load_payload`、`_cleanup_staging`、`build_form_context`、`_finding_snapshot`、`_today`、`_summary` 以及 docx 相关 import。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_evidence_forms.py -q`
Expected: PASS（5 passed）

- [ ] **Step 5: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/store/evidence_forms.py services/agent/tests/test_evidence_forms.py
git commit -m "refactor(form): 取证单存储收窄为编号/manifest/回执，删除旧渲染链路"
```

---

### Task 2: 模板原文提取

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/report_skeleton.py`
- Test: `services/agent/tests/test_report_skeleton.py`

**Interfaces:**
- Produces: `template_text(path: Path) -> dict[str, Any]`
  返回 `{"blocks": [{"kind": "paragraph", "text": str} | {"kind": "table", "rows": list[list[str]]}]}`，
  按文档顺序列出**所有**非空段落与表格（含表格内段落不重复出现在 blocks 里）。
- Produces: `analyze_template(path)` 的返回值新增键 `templateText`（值即 `template_text(path)`）。

- [ ] **Step 1: 写失败测试**

在 `services/agent/tests/test_report_skeleton.py` 末尾追加：

```python
def test_template_text_keeps_paragraphs_tables_and_placeholders(tmp_path):
    doc = Document()
    doc.add_paragraph("项目：{{项目名称}}")
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "编号"
    table.cell(0, 1).text = "标题"
    table.cell(1, 0).text = "{{#疑点}}"
    table.cell(1, 1).text = "{{疑点.标题}}"
    doc.add_paragraph("说明：{{#疑点}}…{{/疑点}}")
    doc.save(str(tmp_path / "t.docx"))

    text = template_text(tmp_path / "t.docx")
    assert text["blocks"][0] == {"kind": "paragraph", "text": "项目：{{项目名称}}"}
    assert text["blocks"][1]["kind"] == "table"
    assert text["blocks"][1]["rows"] == [["编号", "标题"], ["{{#疑点}}", "{{疑点.标题}}"]]
    assert text["blocks"][2]["text"] == "说明：{{#疑点}}…{{/疑点}}"


def test_template_text_skips_empty_paragraphs(tmp_path):
    doc = Document()
    doc.add_paragraph("")
    doc.add_paragraph("   ")
    doc.add_paragraph("唯一一段")
    doc.save(str(tmp_path / "empty.docx"))
    assert template_text(tmp_path / "empty.docx")["blocks"] == [
        {"kind": "paragraph", "text": "唯一一段"}
    ]


def test_analyze_template_includes_template_text(tmp_path):
    path = _build_template(tmp_path / "template.docx")
    skeleton = analyze_template(path)
    assert skeleton["templateText"]["blocks"]
    assert any(
        block["kind"] == "table" and block["rows"][0] == ["序号", "疑点", "金额"]
        for block in skeleton["templateText"]["blocks"]
    )
```

并把测试文件顶部的 import 改为 `from fireeyeaud_agent.store.report_skeleton import analyze_template, template_text`。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_report_skeleton.py -q`
Expected: FAIL — `ImportError: cannot import name 'template_text'`

- [ ] **Step 3: 实现 `template_text`**

在 `report_skeleton.py` 中新增（`_walk_document_blocks` 是关键：要在 `body` 的 XML 子元素上按顺序遍历，
才能让段落与表格保持原始顺序）：

```python
def template_text(path: Path) -> dict[str, Any]:
    """整份模板原文（段落 + 表格，按文档顺序），作为给模型看的参考范本。"""
    from docx.table import Table

    document = Document(str(Path(path)))
    blocks: list[dict[str, Any]] = []
    for element in document.element.body.iterchildren():
        if element.tag.endswith("}p"):
            text = "".join(node.text or "" for node in element.iter(qn("w:t")))
            if text.strip():
                blocks.append({"kind": "paragraph", "text": text})
        elif element.tag.endswith("}tbl"):
            table = Table(element, document)
            rows = [
                ["".join(node.text or "" for node in cell._tc.iter(qn("w:t"))) for cell in row.cells]
                for row in table.rows
            ]
            blocks.append({"kind": "table", "rows": rows})
    return {"blocks": blocks}
```

并在 `analyze_template` 返回字典里加一行 `"templateText": template_text(path),`（放在 `"preamble"` 之后）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_report_skeleton.py -q`
Expected: PASS（6 passed）

- [ ] **Step 5: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/store/report_skeleton.py services/agent/tests/test_report_skeleton.py
git commit -m "feat(form): 模板原文按文档顺序提取，供模型仿写取证单"
```

---

### Task 3: 从报告模块拆出共用渲原语

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/docx_blocks.py`
- Modify: `services/agent/src/fireeyeaud_agent/store/report_docs.py`
- Test: `services/agent/tests/test_report_docs.py`（不改断言，只验证行为不变）

**Interfaces:**
- Produces（`docx_blocks.py`）：
  - `normalize_blocks(blocks: Any) -> list[dict]`
  - `normalize_outline(sections: list[Any], *, existing: list[dict]) -> list[dict]`
  - `apply_style(paragraph, style: dict, document) -> None`
  - `clear_body(document, keep_until: set[str]) -> list[str]`
  - `heading_style(skeleton: dict, level: int) -> dict`
  - `add_text(document, text, style, *, bullet=False, runs=None, align=None)`
  - `write_cell(cell, text, style, document, runs=None, align=None)`
- Consumes: 现有 `report_docs.py` 里同名的私有函数体（逐字搬移，逻辑不变）。

- [ ] **Step 1: 先跑基线测试**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_report_docs.py tests/test_report_workspace_api.py -q`
Expected: PASS（记下通过数，重构后必须一致）

- [ ] **Step 2: 新建 `docx_blocks.py` 并搬移函数**

把以下私有函数**逐字**搬进 `docx_blocks.py` 并改为公开名（去掉前导下划线），全局替换调用点：

| 旧名 | 新名 |
|---|---|
| `_normalize_blocks` | `normalize_blocks` |
| `_normalize_outline` | `normalize_outline` |
| `_apply_style` | `apply_style` |
| `_clear_body` | `clear_body` |
| `_heading_style` | `heading_style` |
| `_add_text` | `add_text` |
| `_write_cell` | `write_cell` |

同时搬移它们依赖的私有助手：`_add_runs`、`_apply_run`、`_apply_align`、`_normalize_runs`、
`_runs_text`、`_normalize_align`、`_clean_refs`、`_element_text`，以及常量 `_MAX_BLOCKS`、
`_MAX_TEXT`、`_MAX_TABLE_ROWS`。`docx_blocks.py` 顶部只需 `docx` 相关 import，不引用任何 store 模块。

- [ ] **Step 3: 让 `report_docs.py` 改为引用新模块**

在 `report_docs.py` 中：
- 删除被搬走的函数体；
- 加 `from . import docx_blocks`；
- 把所有 `_normalize_blocks(` 等调用改为 `docx_blocks.normalize_blocks(`（`_normalize_outline` 同理）；
- **保留** `report_docs._normalize_blocks = docx_blocks.normalize_blocks` 之类的模块级别名**不需要**，但
  `tests/test_report_docs.py` 若直接访问 `report_docs._dir` 等仍要保留 `_dir` / `_load_manifest` 等未搬移的名字。

- [ ] **Step 4: 运行基线测试确认未回归**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_report_docs.py tests/test_report_workspace_api.py -q`
Expected: PASS，数量与 Step 1 相同

- [ ] **Step 5: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/store/docx_blocks.py services/agent/src/fireeyeaud_agent/store/report_docs.py
git commit -m "refactor(form): 抽出 docx 块级渲染原语，供报告与取证单共用"
```

---

### Task 4: 取证单草稿读写（form_docs）

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/form_docs.py`
- Test: `services/agent/tests/test_form_docs.py`

**Interfaces:**
- Consumes: `evidence_forms.forms_dir / next_form_id / snapshot_finding / save_manifest / load_manifest`,
  `findings.get_finding`, `evidence.load_evidence`, `templates.resolve_template / template_path`,
  `report_skeleton.analyze_template`, `docx_blocks.normalize_blocks / normalize_outline`, `project.load_project`
- Produces（签名必须逐字一致，后续任务依赖）：
  - `ID_PATTERN: re.Pattern`（`^QZ-\d{4,}$`）
  - `create_form(root, *, template_id, template_scope, finding_ids, header=None, title=None) -> dict`
    返回 `{"manifest": dict, "body": dict, "skeleton": dict}`
  - `get_document(root, form_id) -> dict`（同上结构）
  - `set_findings(root, form_id, finding_ids: list[str]) -> dict`（返回 body；同时刷新 manifest 的
    `findingIds` / `findingsSnapshot` / `findingCount`，并 `_mark_draft`）
  - `set_outline(root, form_id, sections, *, approved: bool) -> dict`
  - `write_section(root, form_id, section_id, blocks) -> dict`
  - `set_title(root, form_id, title) -> dict`
  - `append_chat(root, form_id, entry: dict) -> None`、`load_chat(root, form_id, limit=40) -> list[dict]`
- `body` 形状：
  ```jsonc
  {
    "schemaVersion": 1, "formId": "QZ-0001", "title": "…", "outlineApproved": false,
    "selectedFindingIds": ["F-0001"],
    "sections": [{"id": "S1", "title": "一、基本情况", "level": 1, "goal": "", "blocks": []}],
    "createdAt": "…", "updatedAt": "…"
  }
  ```
- 默认大纲（`_DEFAULT_OUTLINE`）：`一、基本情况` / `二、取证内容` / `三、结论与建议`，各 `level=1`。
- `manifest["files"]` 初始为 `["manifest.json", "body.json", "skeleton.json", "template.docx"]`。

- [ ] **Step 1: 写失败测试**

新建 `services/agent/tests/test_form_docs.py`：

```python
"""取证单草稿：创建、疑点范围、大纲、章节、标题与对话记录。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt

from fireeyeaud_agent.config import store as config_store
from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store import evidence_forms, form_docs, templates as templates_store
from fireeyeaud_agent.store.findings import create_finding


@pytest.fixture(autouse=True)
def _global_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))


def _template(root: Path) -> str:
    doc = Document()
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title.add_run("取证单")
    run.font.size = Pt(22)
    doc.add_paragraph("项目：{{项目名称}}")
    doc.add_paragraph("一、基本情况", style=doc.styles.add_style("标题 1", 1))
    doc.add_paragraph("二、取证内容", style=doc.styles.add_style("标题 2", 1))
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "编号"
    table.cell(0, 1).text = "标题"
    table.cell(1, 0).text = "{{#疑点}}"
    table.cell(1, 1).text = "{{疑点.标题}}"

    item = config_store.create_item(
        "templates",
        {"scope": "project", "kind": "evidence-form", "name": "取证单模板", "fileName": "form.docx"},
        root,
    )
    target = templates_store.templates_root("project", root) / "evidence-form" / "form.docx"
    target.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(target))
    return str(item["id"])


def _finding(root: Path, title: str = "关联方交易") -> str:
    return create_finding(
        root,
        title=title,
        description="未披露",
        severity="high",
        dataRefs=[],
        sessionId="",
        origin="manual",
        evidenceRefs=["E-0001"],
    )["id"]


def _setup(tmp_path: Path) -> tuple[Path, str, str]:
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)
    (root / ".fireeye" / "project.json").write_text(
        json.dumps({"name": "示例项目", "counters": {}}, ensure_ascii=False), "utf-8"
    )
    return root, _template(root), _finding(root)


def test_create_form_writes_workspace_files(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    created = form_docs.create_form(
        root,
        template_id=template_id,
        template_scope="project",
        finding_ids=[finding_id],
        header={"preparedBy": "张审计"},
        title="关联方取证单",
    )
    manifest, body, skeleton = created["manifest"], created["body"], created["skeleton"]
    assert manifest["id"] == "QZ-0001"
    assert manifest["kind"] == "evidence-form"
    assert manifest["status"] == "draft"
    assert manifest["title"] == "关联方取证单"
    assert manifest["findingIds"] == [finding_id]
    assert manifest["findingsSnapshot"][0]["title"] == "关联方交易"
    assert manifest["findingsSnapshot"][0]["evidence"] == ["E-0001"]
    assert manifest["findingCount"] == 1
    assert body["formId"] == "QZ-0001"
    assert body["selectedFindingIds"] == [finding_id]
    assert body["outlineApproved"] is False
    assert [s["title"] for s in body["sections"]] == ["一、基本情况", "二、取证内容", "三、结论与建议"]
    assert skeleton["templateText"]["blocks"]

    directory = evidence_forms.forms_dir(root) / "QZ-0001"
    for name in ("manifest.json", "body.json", "skeleton.json", "template.docx"):
        assert (directory / name).is_file()


def test_create_form_without_template_sections_uses_default_outline(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    # 覆盖模板为无标题样式
    doc = Document()
    doc.add_paragraph("纯文本模板。")
    target = templates_store.templates_root("project", root) / "evidence-form" / "form.docx"
    doc.save(str(target))
    created = form_docs.create_form(
        root, template_id=template_id, template_scope="project", finding_ids=[finding_id]
    )
    assert [s["title"] for s in created["body"]["sections"]] == [
        "一、基本情况",
        "二、取证内容",
        "三、结论与建议",
    ]


def test_create_form_rejects_unknown_finding_and_wrong_kind(tmp_path):
    root, template_id, _finding_id = _setup(tmp_path)
    with pytest.raises(ApiError) as exc:
        form_docs.create_form(
            root, template_id=template_id, template_scope="project", finding_ids=["F-9999"]
        )
    assert exc.value.code == "E_FINDINGS_REQUIRED"

    report_tpl = config_store.create_item(
        "templates",
        {"scope": "project", "kind": "report", "name": "报告模板", "fileName": "r.docx"},
        root,
    )
    (templates_store.templates_root("project", root) / "report").mkdir(parents=True, exist_ok=True)
    Document().save(str(templates_store.templates_root("project", root) / "report" / "r.docx"))
    with pytest.raises(ApiError) as exc2:
        form_docs.create_form(
            root, template_id=str(report_tpl["id"]), template_scope="project", finding_ids=[]
        )
    assert exc2.value.code == "E_TEMPLATE_KIND"


def test_set_findings_refreshes_scope_and_snapshot(tmp_path):
    root, template_id, first = _setup(tmp_path)
    second = _finding(root, "服务器采购")
    form_docs.create_form(
        root, template_id=template_id, template_scope="project", finding_ids=[first]
    )
    body = form_docs.set_findings(root, "QZ-0001", [first, second])
    assert body["selectedFindingIds"] == [first, second]
    doc = form_docs.get_document(root, "QZ-0001")
    assert doc["manifest"]["findingIds"] == [first, second]
    assert doc["manifest"]["findingCount"] == 2
    assert [item["title"] for item in doc["manifest"]["findingsSnapshot"]] == [
        "关联方交易",
        "服务器采购",
    ]


def test_outline_section_title_and_draft_marking(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    form_docs.create_form(
        root, template_id=template_id, template_scope="project", finding_ids=[finding_id]
    )
    body = form_docs.set_outline(
        root,
        "QZ-0001",
        [{"title": "一、事项经过", "level": 1}, {"title": "二、取证结论", "level": 1}],
        approved=True,
    )
    assert body["outlineApproved"] is True
    assert [s["id"] for s in body["sections"]] == ["S1", "S2"]

    section = form_docs.write_section(
        root,
        "QZ-0001",
        "S2",
        [{"type": "paragraph", "text": "关联方交易未披露。", "sourceRefs": [finding_id]}],
    )
    assert section["status"] == "written"

    with pytest.raises(ApiError) as exc:
        form_docs.write_section(root, "QZ-0001", "S9", [])
    assert exc.value.code == "E_SECTION_NOT_FOUND"

    body = form_docs.set_title(root, "QZ-0001", "新标题")
    assert body["title"] == "新标题"
    assert form_docs.get_document(root, "QZ-0001")["manifest"]["title"] == "新标题"


def test_chat_log_roundtrip(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    form_docs.create_form(
        root, template_id=template_id, template_scope="project", finding_ids=[finding_id]
    )
    form_docs.append_chat(root, "QZ-0001", {"role": "user", "content": "先给大纲"})
    form_docs.append_chat(root, "QZ-0001", {"role": "assistant", "content": "好的"})
    assert [e["content"] for e in form_docs.load_chat(root, "QZ-0001")] == ["先给大纲", "好的"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_form_docs.py -q`
Expected: FAIL — `ModuleNotFoundError: fireeyeaud_agent.store.form_docs`

- [ ] **Step 3: 实现 `form_docs.py`**

按 Interfaces 实现；`create_form` 的流程：
1. `templates_store.resolve_template(root, template_id, template_scope)`，校验 `kind == "evidence-form"`，
   否则抛 `E_TEMPLATE_KIND`（参数 `{"kind": "evidence-form"}`）；`template_path` 为 None 抛 `E_FILE_NOT_FOUND`。
2. 逐个 `findings.get_finding`，为 None 抛 `E_FINDINGS_REQUIRED`（`{"id": finding_id}`）；去重保序。
3. `analyze_template(source)` 得 skeleton；取 `skeleton["sections"]` 作大纲，为空时用 `_DEFAULT_OUTLINE`；
   经 `docx_blocks.normalize_outline(..., existing=[])` 分配 `S1..Sn`。
4. `header` 补默认：`projectName` = `load_project(root/".fireeye")["name"]`，`date` = `now_iso()[:10]`；
   `title` 缺省 = `header.get("formTitle")` → `f"{project_name}取证单"` → `"取证单"`，截断 200 字。
5. `with WORKSPACE_MUTATION_LOCK:` 内 `next_form_id(root)`，建目录，复制模板为 `template.docx`，
   写 `skeleton.json` / `body.json` / `manifest.json`；`artifactRef` 用 POSIX 相对路径。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_form_docs.py -q`
Expected: PASS（6 passed）

- [ ] **Step 5: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/store/form_docs.py services/agent/tests/test_form_docs.py
git commit -m "feat(form): 取证单草稿——创建、疑点范围、大纲、章节与对话记录"
```

---

### Task 5: 取证单校验器

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/form_verify.py`
- Test: `services/agent/tests/test_form_verify.py`

**Interfaces:**
- Consumes: `form_docs.get_document`, `docx_blocks` 无关（自行读 block）
- Produces: `verify_form(root: Path, form_id: str) -> dict`
  返回 `{"ok": bool, "errors": list[dict], "warnings": list[dict], "stats": {"sectionCount", "blockCount", "charCount"}}`

规则（与报告一致，但引用对象是**疑点编号**）：

| code | 条件 |
|---|---|
| `E_TITLE_EMPTY` | `body.title` 为空 |
| `E_OUTLINE_NOT_APPROVED` | `body.outlineApproved` 为假 |
| `E_OUTLINE_EMPTY` | `sections` 为空 |
| `E_DUPLICATE_SECTION` | 章节标题重复 |
| `E_SECTION_EMPTY` | 章节没有 block |
| `E_UNCITED` | `origin != "user"` 且 `sourceRefs` 为空 |
| `E_UNKNOWN_SOURCE` | `sourceRefs` 中有不在 `selectedFindingIds` 的编号，或正文出现 `F-\d{4,}` 且不在范围内 |
| `E_AMOUNT_UNTRACED` | `origin != "user"` 的文本里 `\d{1,3}(,\d{3})+|\d+(\.\d+)?` + `亿元|万元|元` 换算后不在快照金额集合内 |
| `W_TEMPLATE_SECTION_MISSING`（warning） | 模板骨架里的章节标题未出现在当前大纲 |

金额提取与单位换算复用 `report_verify` 的等价实现（`元=1`、`万元=10000`、`亿元=100000000`，
容差 0.01）。

- [ ] **Step 1: 写失败测试**

新建 `services/agent/tests/test_form_verify.py`：

```python
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_form_verify.py -q`
Expected: FAIL — `ModuleNotFoundError: fireeyeaud_agent.store.form_verify`

- [ ] **Step 3: 实现 `form_verify.py`**

实现方式：复制 `report_verify.py` 为起点，把 `selectedFormIds` 换成 `selectedFindingIds`、
`_FORM_REF_RE` 换成 `_FINDING_REF_RE = re.compile(r"F-\d{4,}")`、`_corpus_amounts` 读
`manifest["findingsSnapshot"]`（同一结构），提示文案把「报告」改为「取证单」。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_form_verify.py -q`
Expected: PASS（6 passed）

- [ ] **Step 5: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/store/form_verify.py services/agent/tests/test_form_verify.py
git commit -m "feat(form): 取证单校验器——疑点引用与金额可追溯"
```

---

### Task 6: 取证单导出

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/form_docs.py`
- Test: `services/agent/tests/test_form_export.py`

**Interfaces:**
- Produces: `export_form(root: Path, form_id: str, *, title: str | None = None) -> dict`（返回 manifest）
- 行为：先 `verify_form`，不通过抛 `ApiError("E_VERIFY_FAILED", 409, "error.reportVerifyFailed", {"count": n})`
  （复用既有 key，前端已能渲染）；以 `template.docx` 为底 → `docx_blocks.clear_body` → 按骨架样式
  依次写标题、章节标题、块；写 `document.docx`（先写 `document.tmp.docx` 再 `os.replace`）；
  manifest 置 `status="saved"`、追加 `document.docx` 到 `files`、写 `exportWarnings`。

- [ ] **Step 1: 写失败测试**

新建 `services/agent/tests/test_form_export.py`：

```python
"""取证单导出：模板样式继承、占位符不残留、导出后状态与过期标记。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt

from fireeyeaud_agent.config import store as config_store
from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store import evidence_forms, form_docs, templates as templates_store
from fireeyeaud_agent.store.findings import create_finding


@pytest.fixture(autouse=True)
def _global_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))


def _east_asia(style_or_run, name: str) -> None:
    element = style_or_run.element if hasattr(style_or_run, "element") else style_or_run._element
    element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), name)


def _setup(tmp_path: Path) -> tuple[Path, str, str]:
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)
    (root / ".fireeye" / "project.json").write_text(
        json.dumps({"name": "示例项目", "counters": {}}, ensure_ascii=False), "utf-8"
    )
    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = "仿宋"
    normal.font.size = Pt(16)
    _east_asia(normal, "仿宋_GB2312")
    normal.paragraph_format.line_spacing = Pt(30)
    heading = doc.styles.add_style("标题 1", 1)
    heading.base_style = normal
    heading.font.bold = True
    _east_asia(heading, "黑体")
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title.add_run("取证单范本")
    run.font.size = Pt(22)
    doc.add_paragraph("项目：{{项目名称}}，编号 {{取证单编号}}")
    doc.add_paragraph("一、基本情况", style=heading)
    doc.add_paragraph("此处填写基本情况。")
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "编号"
    table.cell(0, 1).text = "标题"
    table.cell(1, 0).text = "{{#疑点}}"
    table.cell(1, 1).text = "{{疑点.标题}}"

    item = config_store.create_item(
        "templates",
        {"scope": "project", "kind": "evidence-form", "name": "模板", "fileName": "f.docx"},
        root,
    )
    target = templates_store.templates_root("project", root) / "evidence-form" / "f.docx"
    target.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(target))

    finding_id = create_finding(
        root,
        title="关联方交易",
        description="未披露，金额99元。",
        severity="high",
        dataRefs=[],
        sessionId="",
        origin="manual",
    )["id"]
    return root, str(item["id"]), finding_id


def _prepare(root: Path, template_id: str, finding_id: str) -> None:
    form_docs.create_form(
        root, template_id=template_id, template_scope="project", finding_ids=[finding_id]
    )
    form_docs.set_outline(
        root, "QZ-0001", [{"title": "一、事项经过", "level": 1}], approved=True
    )
    form_docs.write_section(
        root,
        "QZ-0001",
        "S1",
        [{"type": "paragraph", "text": "关联方交易未披露，金额99元。", "sourceRefs": [finding_id]}],
    )


def test_export_blocks_when_verification_fails(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    form_docs.create_form(
        root, template_id=template_id, template_scope="project", finding_ids=[finding_id]
    )
    with pytest.raises(ApiError) as exc:
        form_docs.export_form(root, "QZ-0001")
    assert exc.value.code == "E_VERIFY_FAILED"
    assert not (evidence_forms.forms_dir(root) / "QZ-0001" / "document.docx").exists()


def test_export_inherits_template_styles_and_drops_placeholders(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    _prepare(root, template_id, finding_id)

    manifest = form_docs.export_form(root, "QZ-0001")
    assert manifest["status"] == "saved"
    assert "document.docx" in manifest["files"]

    exported = Document(str(evidence_forms.forms_dir(root) / "QZ-0001" / "document.docx"))
    filled = [p for p in exported.paragraphs if p.text.strip()]
    assert filled[0].text == "关联方取证单"
    assert filled[0].alignment == WD_ALIGN_PARAGRAPH.CENTER
    assert filled[0].runs[0].font.size.pt == 22

    heading = next(p for p in filled if p.text == "一、事项经过")
    assert heading.runs[0].font.bold is True
    assert heading.runs[0]._element.rPr.rFonts.get(qn("w:eastAsia")) == "黑体"

    body = next(p for p in filled if "关联方交易未披露" in p.text)
    assert body.runs[0].font.size.pt == 16
    assert body.runs[0]._element.rPr.rFonts.get(qn("w:eastAsia")) == "仿宋_GB2312"

    text = "\n".join(p.text for p in filled)
    assert "{{" not in text
    assert "此处填写" not in text
    # 占位符表格不得残留
    assert all("{{疑点" not in cell.text for table in exported.tables for row in table.rows for cell in row.cells)


def test_editing_after_export_marks_draft_again(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    _prepare(root, template_id, finding_id)
    form_docs.export_form(root, "QZ-0001")
    assert form_docs.get_document(root, "QZ-0001")["manifest"]["status"] == "saved"

    form_docs.write_section(
        root,
        "QZ-0001",
        "S1",
        [{"type": "paragraph", "text": "关联方交易未披露，金额99元。", "sourceRefs": [finding_id], "origin": "user"}],
    )
    assert form_docs.get_document(root, "QZ-0001")["manifest"]["status"] == "draft"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_form_export.py -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'export_form'`

- [ ] **Step 3: 实现 `export_form`**

把 `report_docs.export_report` 的导出段搬过来（`_clear_body` → `docx_blocks.clear_body`、
`_add_text` → `docx_blocks.add_text`、`_heading_style` → `docx_blocks.heading_style`、
`_write_cell` → `docx_blocks.write_cell`），只改三处：
- 校验调用 `from .form_verify import verify_form`；
- `skeleton.get("title")` 为空时用正文样式加粗居中放大 6pt（与报告一致）；
- manifest 字段：`formId`（不写 `reportId`）；`_save_manifest` 用 `evidence_forms.save_manifest`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_form_export.py -q`
Expected: PASS（3 passed）

- [ ] **Step 5: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/store/form_docs.py services/agent/tests/test_form_export.py
git commit -m "feat(form): 取证单导出——模板样式继承、占位符不落盘"
```

---

### Task 7: 对话代理（kind 参数化）

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/agent/form_agent.py`
- Modify: `services/agent/src/fireeyeaud_agent/agent/report_agent.py`（抽出可复用的流式循环）
- Test: `services/agent/tests/test_form_agent.py`

**Interfaces:**
- Produces（`form_agent.py`）：
  - `TOOL_NAMES = {"context": "form_context", "outline": "form_set_outline", "section": "form_write_section", "title": "form_set_title", "verify": "form_verify"}`
  - `system_prompt(form_title: str, locale: str | None) -> str`
  - `build_context(root: Path, form_id: str) -> dict`（键：`取证单`、`模板骨架`、`模板原文`、`选中疑点`、`当前大纲`、`当前正文`、`校验`）
  - `stream_form_chat(root, form_id, message, *, model_id=None, locale=None) -> AsyncIterator[dict]`
- Consumes: `form_docs.*`, `form_verify.verify_form`

模型工具（名称与参数）：
- `form_context()` → JSON
- `form_set_outline(sections: list[{title, level, goal}])` → `{"ok": true, "outline": [...]}`
- `form_write_section(section_id: str, blocks: list[BlockItem])` → `{"ok": true, "sectionId", "title", "blocks": n}`
- `form_set_title(title: str)`
- `form_verify()`

- [ ] **Step 1: 写失败测试**

新建 `services/agent/tests/test_form_agent.py`：

```python
"""取证单代理：上下文含整份模板原文，工具读写 body.json，流式循环可用。"""

from __future__ import annotations

import json

import pytest
from langchain_core.messages import AIMessageChunk, HumanMessage, SystemMessage

from fireeyeaud_agent.agent import form_agent
from fireeyeaud_agent.store import form_docs

from test_form_docs import _setup


@pytest.fixture(autouse=True)
def _global_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))


def _create(root, template_id, finding_id):
    form_docs.create_form(
        root, template_id=template_id, template_scope="project", finding_ids=[finding_id]
    )


def _tools(root):
    return {tool.name: tool for tool in form_agent._tools(root, "QZ-0001")}


def test_context_includes_full_template_text(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    _create(root, template_id, finding_id)
    context = json.loads(_tools(root)["form_context"].invoke({}))
    texts = json.dumps(context, ensure_ascii=False)
    assert "{{项目名称}}" in texts
    assert "{{#疑点}}" in texts
    assert context["选中疑点"][0]["编号"] == finding_id
    assert context["当前大纲"][0]["状态"] == "空"


def test_write_section_requires_approved_outline(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    _create(root, template_id, finding_id)
    tools = _tools(root)
    tools["form_set_outline"].invoke({"sections": [{"title": "一、事项经过", "level": 1}]})
    result = json.loads(
        tools["form_write_section"].invoke(
            {
                "section_id": "S1",
                "blocks": [{"type": "paragraph", "text": "未确认", "sourceRefs": [finding_id]}],
            }
        )
    )
    assert result["ok"] is False
    assert result["code"] == "E_OUTLINE_NOT_APPROVED"


def test_system_prompt_is_form_specific():
    prompt = form_agent.system_prompt("关联方取证单", "zh-CN")
    assert "form_set_outline" in prompt
    assert "取证单" in prompt
    assert "sourceRefs" in prompt
    assert "不得编造" in prompt


class _FakeModel:
    def __init__(self) -> None:
        self.calls = 0
        self.seen: list[list] = []

    def bind_tools(self, tools):  # noqa: ANN001
        return self

    async def astream(self, messages):  # noqa: ANN001
        self.seen.append(list(messages))
        self.calls += 1
        if self.calls == 1:
            yield AIMessageChunk(
                content="",
                tool_call_chunks=[
                    {
                        "name": "form_set_outline",
                        "args": json.dumps(
                            {"sections": [{"title": "一、事项经过", "level": 1}]},
                            ensure_ascii=False,
                        ),
                        "id": "call-1",
                        "index": 0,
                    }
                ],
            )
        else:
            yield AIMessageChunk(content="大纲已给出，请确认。")


async def test_stream_chat_runs_tools_and_injects_template(tmp_path, monkeypatch):
    root, template_id, finding_id = _setup(tmp_path)
    _create(root, template_id, finding_id)
    fake = _FakeModel()
    monkeypatch.setattr(form_agent, "build_chat_model", lambda *a, **k: fake)

    events = [event async for event in form_agent.stream_form_chat(root, "QZ-0001", "先给大纲")]
    kinds = [event["event"] for event in events]
    assert "tool" in kinds and "report" in kinds
    assert kinds[-1] == "done"

    system_text = "\n".join(
        str(message.content) for message in fake.seen[0] if isinstance(message, SystemMessage)
    )
    assert "模板原文" in system_text
    assert "{{#疑点}}" in system_text
    assert "当前取证单正文" in system_text

    human = [m.content for m in fake.seen[0] if isinstance(m, HumanMessage)]
    assert human.count("先给大纲") == 1

    body = form_docs.get_document(root, "QZ-0001")["body"]
    assert [s["title"] for s in body["sections"]] == ["一、事项经过"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_form_agent.py -q`
Expected: FAIL — `ModuleNotFoundError: fireeyeaud_agent.agent.form_agent`

- [ ] **Step 3: 实现 `form_agent.py`**

结构复制 `report_agent.py`，改动点：
- `_compact_skeleton` 增加键 `"templateText"`（直接透传 `skeleton["templateText"]`，不裁剪）；
- `_compact_findings(manifest)` 从 `manifest["findingsSnapshot"]` 生成
  `[{"编号","标题","描述","风险","状态","科目","金额","币种","证据"}]`（描述截断 1500 字）；
- `build_context` 返回 KeysPerInterfaces，其中 `"模板原文"` = `skeleton.get("templateText")`；
- system prompt 增加一句：`参考范本是模板原文（含 {{占位符}} 与表格），它只说明取证单长什么样；请按它的栏目与表格结构仿写新正文，不要输出 {{...}}。`
- `stream_form_chat` 内部调用 `form_docs.append_chat` / `form_docs.get_document` / `form_verify.verify_form`，
  `mutated` 判定集合为新工具名；`yield {"event": "report", ...}` 保持不变（前端复用同一事件名）。

同时把 `report_agent.py` 中「模型回流 → 工具 → 事件」的循环抽为
`async def _run_tool_loop(model, messages, tool_map, mutated_names: set[str]) -> AsyncIterator[dict]`，
`report_agent.stream_report_chat` 与 `form_agent.stream_form_chat` 都调用它。测试 `test_report_agent_tools.py`
必须保持全绿。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_form_agent.py tests/test_report_agent_tools.py -q`
Expected: PASS（全部）

- [ ] **Step 5: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/agent/form_agent.py services/agent/src/fireeyeaud_agent/agent/report_agent.py services/agent/tests/test_form_agent.py
git commit -m "feat(form): 取证单写作代理——整份模板作参考范本，先大纲后正文"
```

---

### Task 8: 取证单 API

**Files:**
- Rewrite: `services/agent/src/fireeyeaud_agent/api/evidence_forms.py`
- Test: `services/agent/tests/test_evidence_forms_api.py`（重写）

**Interfaces:**
- Produces 路由（全部挂在 `API_PREFIX`，依赖 `require_token`）：
  - `POST /evidence-forms/drafts` → 201，body `{templateId, templateScope, findingIds, header?, title?}`，返回 `{manifest, body, skeleton}`
  - `GET /evidence-forms` → `{items}`
  - `GET /evidence-forms/{form_id}` → manifest
  - `DELETE /evidence-forms/{form_id}` → `{ok: true}`
  - `GET /evidence-forms/{form_id}/doc` → `{manifest, body, skeleton}`
  - `PUT /evidence-forms/{form_id}/outline` body `{sections, approved}` → body
  - `PUT /evidence-forms/{form_id}/sections/{section_id}` body `{blocks}` → section
  - `PUT /evidence-forms/{form_id}/title` body `{title}` → body
  - `PUT /evidence-forms/{form_id}/findings` body `{findingIds}` → body
  - `POST /evidence-forms/{form_id}/verify` → verify result
  - `POST /evidence-forms/{form_id}/export` body `{title?}` → manifest
  - `GET /evidence-forms/{form_id}/messages` → `{items}`
  - `POST /evidence-forms/{form_id}/chat` body `{message, locale?, modelId?}` → SSE
  - `POST /evidence-forms/{form_id}/receipt` body `{path, note?}` → manifest
  - `DELETE /evidence-forms/{form_id}/receipt` → manifest

- [ ] **Step 1: 写失败测试**

把 `services/agent/tests/test_evidence_forms_api.py` 整体替换为（复用 `test_form_docs._setup` 的模板与疑点）：

```python
"""取证单 API：草稿、大纲、章节、校验、导出、回执与删除。"""

from __future__ import annotations

import httpx
import pytest

from fireeyeaud_agent.main import app

from test_form_docs import _setup


@pytest.fixture(autouse=True)
def _global_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))


async def test_form_workspace_flow(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})

        created = await client.post(
            "/api/v1/evidence-forms/drafts",
            json={
                "templateId": template_id,
                "templateScope": "project",
                "findingIds": [finding_id],
                "title": "关联方取证单",
            },
        )
        assert created.status_code == 201, created.text
        draft = created.json()
        form_id = draft["manifest"]["id"]
        assert form_id == "QZ-0001"
        assert draft["manifest"]["status"] == "draft"

        doc = (await client.get(f"/api/v1/evidence-forms/{form_id}/doc")).json()
        assert doc["body"]["selectedFindingIds"] == [finding_id]
        assert doc["skeleton"]["templateText"]["blocks"]

        outline = await client.put(
            f"/api/v1/evidence-forms/{form_id}/outline",
            json={"approved": True, "sections": [{"id": "S1", "title": "一、事项经过", "level": 1}]},
        )
        assert outline.status_code == 200

        section = await client.put(
            f"/api/v1/evidence-forms/{form_id}/sections/S1",
            json={"blocks": [{"type": "paragraph", "text": "关联方交易未披露。", "sourceRefs": [finding_id]}]},
        )
        assert section.status_code == 200

        check = (await client.post(f"/api/v1/evidence-forms/{form_id}/verify")).json()
        assert check["ok"] is True, check["errors"]

        exported = await client.post(f"/api/v1/evidence-forms/{form_id}/export", json={})
        assert exported.status_code == 200
        assert exported.json()["status"] == "saved"
        assert (
            root / ".fireeye" / "artifacts" / "evidence-forms" / form_id / "document.docx"
        ).is_file()

        listed = (await client.get("/api/v1/evidence-forms")).json()["items"]
        assert [item["id"] for item in listed] == [form_id]

        receipt = tmp_path / "客户签收.pdf"
        receipt.write_bytes(b"%PDF")
        attached = await client.post(
            f"/api/v1/evidence-forms/{form_id}/receipt", json={"path": str(receipt)}
        )
        assert attached.json()["receipt"]["name"] == "客户签收.pdf"
        assert (await client.delete(f"/api/v1/evidence-forms/{form_id}/receipt")).json()["receipt"] is None

        assert (await client.delete(f"/api/v1/evidence-forms/{form_id}")).status_code == 200
        assert (await client.get("/api/v1/evidence-forms")).json()["items"] == []
        await client.post("/api/v1/workspaces/close")


async def test_form_findings_endpoint(tmp_path):
    root, template_id, first = _setup(tmp_path)
    from fireeyeaud_agent.store.findings import create_finding

    second = create_finding(
        root, title="服务器采购", description="", severity="low", dataRefs=[], sessionId="", origin="manual"
    )["id"]
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        created = await client.post(
            "/api/v1/evidence-forms/drafts",
            json={"templateId": template_id, "templateScope": "project", "findingIds": [first]},
        )
        form_id = created.json()["manifest"]["id"]
        updated = await client.put(
            f"/api/v1/evidence-forms/{form_id}/findings", json={"findingIds": [first, second]}
        )
        assert updated.status_code == 200
        assert updated.json()["selectedFindingIds"] == [first, second]
        doc = (await client.get(f"/api/v1/evidence-forms/{form_id}/doc")).json()
        assert doc["manifest"]["findingCount"] == 2
        await client.post("/api/v1/workspaces/close")


async def test_legacy_preview_routes_are_gone(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        response = await client.post(
            "/api/v1/evidence-forms/preview",
            json={"templateId": template_id, "templateScope": "project", "findingIds": [finding_id]},
        )
        assert response.status_code in (404, 405)
        await client.post("/api/v1/workspaces/close")


async def test_forms_api_requires_workspace():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/close")
        assert (await client.get("/api/v1/evidence-forms")).status_code == 409
        assert (await client.get("/api/v1/evidence-forms/QZ-0001/doc")).status_code == 409
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_evidence_forms_api.py -q`
Expected: FAIL — 现有 `POST /evidence-forms/drafts` 不存在（404）

- [ ] **Step 3: 重写 `api/evidence_forms.py`**

按 Interfaces 实现；SSE 端点照抄 `api/reports.py` 的 `chat` 写法，调用 `stream_form_chat`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_evidence_forms_api.py -q`
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/api/evidence_forms.py services/agent/tests/test_evidence_forms_api.py
git commit -m "feat(form): 取证单写作台 API——草稿/大纲/章节/校验/导出/对话/回执"
```

---

### Task 9: 一次性迁移（清旧数据并改写报告引用）

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/migrate.py`
- Modify: `services/agent/src/fireeyeaud_agent/store/workspace.py:120-126`
- Test: `services/agent/tests/test_form_migration.py`

**Interfaces:**
- Produces: `migrate_evidence_form_workspace(root: Path) -> dict`
  返回 `{"ran": bool, "removedForms": list[str], "removedReceipts": int, "updatedReports": list[str]}`。
- 幂等：标记文件 `<root>/.fireeye/migrations.json`，键 `"evidenceFormWorkspace": 1`；
  已存在直接返回 `{"ran": False, ...空列表}`。
- 判「旧取证单」：`manifest.json` 里**没有** `body.json`（新格式一定有）或 `manifest.get("files")`
  里不含 `"body.json"`。
- 清理动作：
  1. 对每个旧取证单：删除 `回执单/` 下名为 `<id>_*` 的文件；删除其目录。
  2. 删除 `.fireeye/staging/` 整个目录。
  3. 对 `.fireeye/artifacts/reports/RPT-*` 的每个 manifest：从 `formIds` 与 `formsSnapshot`
     中移除 `id in removed` 的条目；`findingCount` 重算为剩余 `formsSnapshot` 的
     `len(findings)` 之和；若 `files` 含 `document.docx` 则 `status` 置 `"draft"` 并追加
     `exportWarnings` 说明「部分取证单已被清理，请重新导出」。
  4. `project.json`：`counters["evidenceForm"] = 0`。
  5. 写迁移标记。

- [ ] **Step 1: 写失败测试**

新建 `services/agent/tests/test_form_migration.py`：

```python
"""旧取证单一次性迁移：清产物与回执、改写报告引用、编号归零、幂等。"""

from __future__ import annotations

import json
from pathlib import Path

from fireeyeaud_agent.store import evidence_forms, migrate


def _root(tmp_path: Path) -> Path:
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)
    (root / ".fireeye" / "project.json").write_text(
        json.dumps({"name": "示例项目", "counters": {"evidenceForm": 7}}), "utf-8"
    )
    return root


def _legacy_form(root: Path, form_id: str) -> None:
    directory = evidence_forms.forms_dir(root) / form_id
    directory.mkdir(parents=True)
    (directory / "manifest.json").write_text(
        json.dumps(
            {
                "id": form_id,
                "kind": "evidence-form",
                "title": "旧取证单",
                "files": ["document.docx", "template.docx"],
                "findingsSnapshot": [{"id": "F-0001", "title": "关联方", "description": "未披露"}],
            },
            ensure_ascii=False,
        ),
        "utf-8",
    )
    (directory / "document.docx").write_bytes(b"old")
    receipts = root / "回执单"
    receipts.mkdir(exist_ok=True)
    (receipts / f"{form_id}_客户签收.pdf").write_bytes(b"%PDF")


def _report(root: Path, report_id: str, form_ids: list[str], finding_count: int) -> Path:
    directory = root / ".fireeye" / "artifacts" / "reports" / report_id
    directory.mkdir(parents=True)
    manifest = {
        "id": report_id,
        "kind": "report",
        "status": "saved",
        "title": "报告",
        "formIds": form_ids,
        "formsSnapshot": [
            {"id": fid, "title": "旧取证单", "findings": [{"id": "F-0001"}]} for fid in form_ids
        ],
        "findingCount": finding_count,
        "files": ["manifest.json", "body.json", "document.docx"],
    }
    (directory / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), "utf-8")
    return directory


def test_migration_removes_legacy_and_rewrites_reports(tmp_path):
    root = _root(tmp_path)
    _legacy_form(root, "QZ-0001")
    _legacy_form(root, "QZ-0002")
    report_dir = _report(root, "RPT-0001", ["QZ-0001", "QZ-0002"], 2)
    staging = root / ".fireeye" / "staging" / "abc"
    staging.mkdir(parents=True)

    result = migrate.migrate_evidence_form_workspace(root)

    assert result["ran"] is True
    assert sorted(result["removedForms"]) == ["QZ-0001", "QZ-0002"]
    assert not (evidence_forms.forms_dir(root) / "QZ-0001").exists()
    assert not (root / "回执单").exists() or not any((root / "回执单").iterdir())
    assert not (root / ".fireeye" / "staging").exists()

    manifest = json.loads((report_dir / "manifest.json").read_text("utf-8"))
    assert manifest["formIds"] == []
    assert manifest["formsSnapshot"] == []
    assert manifest["findingCount"] == 0
    assert manifest["status"] == "draft"
    assert manifest["exportWarnings"]

    project = json.loads((root / ".fireeye" / "project.json").read_text("utf-8"))
    assert project["counters"]["evidenceForm"] == 0


def test_migration_is_idempotent_and_keeps_new_forms(tmp_path):
    root = _root(tmp_path)
    _legacy_form(root, "QZ-0001")
    migrate.migrate_evidence_form_workspace(root)

    # 迁移后新建的取证单（有新格式 body.json）不能被二次清理
    new_dir = evidence_forms.forms_dir(root) / "QZ-0002"
    new_dir.mkdir(parents=True)
    (new_dir / "body.json").write_text("{}", "utf-8")
    (new_dir / "manifest.json").write_text(
        json.dumps({"id": "QZ-0002", "kind": "evidence-form", "files": ["body.json"]}), "utf-8"
    )

    again = migrate.migrate_evidence_form_workspace(root)
    assert again["ran"] is False
    assert new_dir.is_dir()


def test_migration_leaves_untouched_when_nothing_to_do(tmp_path):
    root = _root(tmp_path)
    result = migrate.migrate_evidence_form_workspace(root)
    assert result["ran"] is True
    assert result["removedForms"] == []
    marker = json.loads((root / ".fireeye" / "migrations.json").read_text("utf-8"))
    assert marker["evidenceFormWorkspace"] == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_form_migration.py -q`
Expected: FAIL — `ModuleNotFoundError: fireeyeaud_agent.store.migrate`

- [ ] **Step 3: 实现 `migrate.py` 并接入工作区打开**

实现 `migrate_evidence_form_workspace`；在 `workspace.py` 的 `open()` 中，`self.db = Database(...)` 之后、
`project["evidence"] = verify_evidence_chain(root)` 之前插入：

```python
from .migrate import migrate_evidence_form_workspace

try:
    migrate_evidence_form_workspace(root)
except OSError:
    pass  # 迁移失败不阻塞打开；下次打开重试
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_form_migration.py tests/test_workspaces.py -q`
Expected: PASS（全部）

- [ ] **Step 5: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/store/migrate.py services/agent/src/fireeyeaud_agent/store/workspace.py services/agent/tests/test_form_migration.py
git commit -m "feat(form): 旧取证单一次性迁移——清产物/回执并改写报告引用"
```

---

### Task 10: 归档统计指向新 store

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/archive.py:268-273`
- Test: `services/agent/tests/test_archive_store.py`（追加一条）

**Interfaces:**
- 行为不变：`_counts()` 里的 `evidenceForms` 数的是新格式取证单数量。

- [ ] **Step 1: 写失败测试**

在 `services/agent/tests/test_archive_store.py` 末尾追加：

```python
def test_archive_counts_new_format_evidence_forms(tmp_path):
    from fireeyeaud_agent.store import evidence_forms

    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)
    directory = evidence_forms.forms_dir(root) / "QZ-0001"
    directory.mkdir(parents=True)
    evidence_forms.save_manifest(
        root,
        {"id": "QZ-0001", "kind": "evidence-form", "title": "新取证单", "createdAt": "2026-10-24"},
    )
    from fireeyeaud_agent.store.archive import _counts

    assert _counts(root)["evidenceForms"] == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_archive_store.py -q -k evidence_forms`
Expected: FAIL（`evidenceForms` 为 0）或 `ImportError: _counts`

- [ ] **Step 3: 调整 `archive.py`**

若 `_counts` 不公开，改为在 `archive.py` 内保留原名并确认调用 `evidence_forms.list_evidence_forms(root)`
（Task 1 已保证该方法只认 `kind == "evidence-form"` 的新旧一致 manifest，无需改逻辑；
本步只补测试与必要的导出）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_archive_store.py -q`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/store/archive.py services/agent/tests/test_archive_store.py
git commit -m "test(form): 归档统计覆盖新取证单产物"
```

---

### Task 11: 前端类型与 API

**Files:**
- Modify: `packages/shared/src/types.ts:446-464`
- Modify: `apps/renderer/src/lib/api.ts:1147-1196`
- Test: `apps/renderer/tests/api.test.ts`（若无则新建）

**Interfaces:**
- `EvidenceFormManifest` 增字段：`status?: 'draft' | 'saved'`、`updatedAt?: string`、`exportWarnings?: string[]`
- 新增 `EvidenceFormBody`（与 `ReportBody` 同构但用 `formId` / `selectedFindingIds`）
- 新增 `EvidenceFormDocument = { manifest: EvidenceFormManifest; body: EvidenceFormBody; skeleton: ReportSkeleton }`
- API 导出：`createFormDraft(input)`, `getFormDocument(id)`, `setFormOutline(id, sections, approved)`,
  `writeFormSection(id, sectionId, blocks)`, `setFormTitle(id, title)`, `setFormFindings(id, findingIds)`,
  `verifyFormDocument(id)`, `exportFormDocument(id, title?)`, `listFormMessages(id)`,
  `streamFormChat(id, input, onEvent, signal)`
- 删除：`previewEvidenceForm`, `commitEvidenceForm`

- [ ] **Step 1: 改类型**

在 `types.ts` 的 `EvidenceFormManifest` 中补 `status?` / `updatedAt?` / `exportWarnings?`；新增：

```ts
export interface EvidenceFormBody {
  schemaVersion: number;
  formId: string;
  title: string;
  outlineApproved: boolean;
  selectedFindingIds: string[];
  sections: ReportSection[];
  createdAt?: string;
  updatedAt?: string;
}

export interface EvidenceFormDocument {
  manifest: EvidenceFormManifest;
  body: EvidenceFormBody;
  skeleton: ReportSkeleton;
}
```

- [ ] **Step 2: 改 API 层**

把 `api.ts` 里 `GenerateFormInput` / `previewEvidenceForm` / `commitEvidenceForm` 替换为：

```ts
export interface CreateFormDraftInput {
  templateId: string;
  templateScope: ConfigScope;
  findingIds: string[];
  header?: Record<string, string>;
  title?: string;
}

export function createFormDraft(input: CreateFormDraftInput): Promise<EvidenceFormDocument> {
  return request<EvidenceFormDocument>('/evidence-forms/drafts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getFormDocument(id: string): Promise<EvidenceFormDocument> {
  return request<EvidenceFormDocument>(`/evidence-forms/${id}/doc`);
}

export function setFormOutline(
  id: string,
  sections: Array<{ id?: string; title: string; level?: number; goal?: string }>,
  approved: boolean,
): Promise<EvidenceFormBody> {
  return request<EvidenceFormBody>(`/evidence-forms/${id}/outline`, {
    method: 'PUT',
    body: JSON.stringify({ sections, approved }),
  });
}

export function writeFormSection(
  id: string,
  sectionId: string,
  blocks: ReportBlock[],
): Promise<ReportSection> {
  return request<ReportSection>(`/evidence-forms/${id}/sections/${sectionId}`, {
    method: 'PUT',
    body: JSON.stringify({ blocks }),
  });
}

export function setFormTitle(id: string, title: string): Promise<EvidenceFormBody> {
  return request<EvidenceFormBody>(`/evidence-forms/${id}/title`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  });
}

export function setFormFindings(id: string, findingIds: string[]): Promise<EvidenceFormBody> {
  return request<EvidenceFormBody>(`/evidence-forms/${id}/findings`, {
    method: 'PUT',
    body: JSON.stringify({ findingIds }),
  });
}

export function verifyFormDocument(id: string): Promise<ReportVerifyResult> {
  return request<ReportVerifyResult>(`/evidence-forms/${id}/verify`, { method: 'POST' });
}

export function exportFormDocument(id: string, title?: string): Promise<EvidenceFormManifest> {
  return request<EvidenceFormManifest>(`/evidence-forms/${id}/export`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export function listFormMessages(id: string): Promise<{ items: ReportChatEntry[] }> {
  return request<{ items: ReportChatEntry[] }>(`/evidence-forms/${id}/messages`);
}

export async function streamFormChat(
  id: string,
  input: { message: string; locale?: string; modelId?: string },
  onEvent: (event: ReportStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  // 与 streamReportChat 同实现，仅路径不同
}
```

- [ ] **Step 3: 类型检查**

Run: `npm run renderer:typecheck`
Expected: 只剩「旧组件仍在用 `previewEvidenceForm`」的报错（Task 13/14 解决），无 `types.ts` / `api.ts` 自身报错。

- [ ] **Step 4: 提交**

```bash
git add packages/shared/src/types.ts apps/renderer/src/lib/api.ts
git commit -m "feat(form): 取证单写作台前端类型与 API"
```

---

### Task 12: 通用写作台参数化

**Files:**
- Modify: `apps/renderer/src/store/reportWorkspace.ts`
- Create: `apps/renderer/src/components/workspace/WorkspaceShell.tsx`
- Create: `apps/renderer/src/components/workspace/WorkspaceChat.tsx`
- Create: `apps/renderer/src/components/workspace/WorkspacePreview.tsx`
- Modify: `apps/renderer/src/components/reports/ReportWorkspace.tsx`

**Interfaces:**
- `WorkspaceKind = 'report' | 'evidence-form'`
- `WorkspaceShell({ kind, id, refresh })`：左 `WorkspaceChat`、右 `WorkspacePreview`
- `WorkspaceChat({ kind, id, selectedIds, onChanged })`
- `WorkspacePreview({ kind, doc, onRefresh })`，`doc: ReportDocument | EvidenceFormDocument`
- 文案命名空间：`report` 与 `evidence-form` 各有一套同名 key（`chatTitle`、`chatHint` 等）。

- [ ] **Step 1: 参数化 store**

`reportWorkspace.ts` 增加两个 store 实例共用的工厂：
`createWorkspaceStore(kind)` 返回与现有 `useReportDocStore` 同形的 state，内部按 kind 调
`getReportDocument` / `getFormDocument` 与 `setReportOutline` / `setFormOutline`。
导出 `useReportDocStore`（现状不变）与 `useFormDocStore`。

- [ ] **Step 2: 抽出三个组件**

- `WorkspaceChat`：复制 `ReportChat.tsx`，把 `listReportMessages` / `streamReportChat` / `setReportForms`
  换成按 kind 选择；`TOOL_LABEL` 增加 `form_*` 键；`useFormsStore` 在 kind 为 `evidence-form` 时改为
  `useFindingsStore.items`（勾选疑点）。
- `WorkspacePreview`：复制 `ReportPreview.tsx`，按 kind 选择 `verifyX` / `exportX` / `setXTitle` /
  `setXOutline` / `writeXSection`；`docxPath` 用 `${wsPath}/${doc.manifest.artifactRef}/document.docx`。
- `WorkspaceShell`：复制 `ReportWorkspace.tsx` 的两栏布局。

- [ ] **Step 3: 报告改用通用组件**

`ReportWorkspace.tsx` 改为 `<WorkspaceShell kind="report" id={reportId} />`；删除原
`ReportChat.tsx` / `ReportPreview.tsx` 的重复实现（保留文件但在内部转发到通用组件，避免一次性改动过大）。

- [ ] **Step 4: 类型检查与前端测试**

Run: `npm run renderer:typecheck && npm test`
Expected: PASS（`ReportWorkspace` 行为不变）

- [ ] **Step 5: 提交**

```bash
git add apps/renderer/src/store/reportWorkspace.ts apps/renderer/src/components/workspace apps/renderer/src/components/reports
git commit -m "refactor(form): 写作台抽为通用组件，报告与取证单共用"
```

---

### Task 13: 取证单面板（仿报告上下分栏）

**Files:**
- Rewrite: `apps/renderer/src/components/results/EvidenceFormsView.tsx`
- Create: `apps/renderer/src/components/forms/NewEvidenceFormDialog.tsx`
- Modify: `apps/renderer/src/store/forms.ts`
- Modify: `apps/renderer/src/store/ui.ts`（新增 `EvidenceFormTab` 与 `openEvidenceForm`）
- Modify: `apps/renderer/src/components/RightArea.tsx`
- Modify: `packages/shared/src/locales/zh-CN.ts` / `en.ts`

**Interfaces:**
- `useFormsStore` 增加：`create(input: CreateFormDraftInput) => Promise<EvidenceFormDocument>`
- `ui.ts` 新增：
  ```ts
  export interface EvidenceFormTab {
    id: string; kind: 'evidenceForm'; formId: string; name: string;
  }
  openEvidenceForm: (formId: string, name: string) => Promise<void>;
  ```
- `EvidenceFormsView` 结构：`.reports-panel`（复用报告面板样式）
  - 上栏 `records`：标题「取证单记录」+ 新建按钮 + 列表（点击打开写作台；操作：下载 / 回执 / 删除）
  - 下栏 `available findings`：勾选疑点（`useFindingsStore.items`，与 `selectedIds` 双向同步）

- [ ] **Step 1: 新建弹窗**

`NewEvidenceFormDialog` 复制 `NewReportDialog`，改：
- 模板类型 `listTemplates('evidence-form')`；
- 疑点勾选直接来自 `useFindingsStore.selectedIds`（只读展示 + 计数），不再用自己的 `selected` state；
- 提交调 `createFormDraft({ templateId, templateScope: template.scope, findingIds: selectedIds, title, header: { formTitle: title } })`，
  成功后 `onCreated(doc.manifest.id, doc.body.title)`。

- [ ] **Step 2: 面板与 tab**

`EvidenceFormsView` 用 `.reports-panel` 布局；点击记录调 `openEvidenceForm(id, title)`；
`RightArea` 增加分支 `active.kind === 'evidenceForm'` → `<WorkspaceShell kind="evidence-form" id={active.formId} />`，
图标用 `FileCheck2`。

- [ ] **Step 3: 文案**

`zh-CN.ts` 的 `evidence-form` 命名空间补充：
`newForm`、`records`、`availableFindings`、`noFindings`、`createTitle`、`create`、`creating`、
`titleLabel`、`templateRequired`、`statusDraft`、`statusSaved`、`statusDirty`、`created`、
`openWorkspace`、`chatTitle`、`chatHint`、`chatPlaceholder`、`findingsSelected`、`findingsForTurn`、
`send`、`thinking`、`toolOutline`、`toolSection`、`toolTitle`、`toolCheck`、`verify`、`verifyOk`、
`verifyFailed`、`verifyWarnings`、`exportWord`、`exported`、`openDocx`、`needExport`、`titleRequired`、
`savedChanges`、`discardTitle`、`discardMessage`、`outlinePending`、`outlineHint`、`confirmOutline`、
`sectionsEmpty`、`sectionEmpty`、`templateSkeleton`、`titlePlaceholder`、`userRole`、`templateRef`。
`en.ts` 同步。删除 `preview`、`previewTitle`、`saved`（旧语义）、`defaultSaved` 等仅旧链路使用的键。

- [ ] **Step 4: 类型检查与构建**

Run: `npm run renderer:typecheck && npm run renderer:build`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/renderer/src/components/results/EvidenceFormsView.tsx apps/renderer/src/components/forms/NewEvidenceFormDialog.tsx apps/renderer/src/store apps/renderer/src/components/RightArea.tsx packages/shared/src/locales
git commit -m "feat(form): 取证单面板改为上下分栏，新建直接进写作台"
```

---

### Task 14: 报告面板与旧组件清理

**Files:**
- Modify: `apps/renderer/src/components/reports/ReportsPanel.tsx:185-217`
- Modify: `apps/renderer/src/components/reports/NewReportDialog.tsx`
- Delete: `apps/renderer/src/components/artifacts/GenerateFormDialog.tsx`
- Delete: `apps/renderer/src/components/artifacts/GeneratedDocPreview.tsx`
- Delete: `apps/renderer/src/components/artifacts/TemplatePicker.tsx`（仅被取证单弹窗使用；先 `grep` 确认）
- Modify: `apps/renderer/src/components/artifacts/ReceiptDialog.tsx`（仅更新类型来源）

**Interfaces:**
- `ReportsPanel` 下栏「项目取证单」= `useFormsStore.items`（新写作台记录），点击走 `openEvidenceForm`；
  空态复用 `report.noForms`。
- `NewReportDialog` 的 `forms` 由 `ReportsPanel` 传入，来源仍为 `useFormsStore.items`（已自动升级）。

- [ ] **Step 1: 改报告面板下栏**

把 `previewForm(form.id, form.artifactRef)` 改为 `openEvidenceForm(form.id, form.title)`；
meta 里的 `form.findingIds.length` 保留（新 manifest 仍有该字段）。

- [ ] **Step 2: 删除旧组件并修引用**

逐个 `grep` 删除文件的所有 import 后删除文件；`ReceiptDialog` 的 `EvidenceFormManifest` 来自 shared，无需改。

- [ ] **Step 3: 类型检查、构建、前端测试**

Run: `npm run renderer:typecheck && npm run renderer:build && npm test`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add -A apps/renderer/src/components
git commit -m "refactor(form): 报告面板下栏改用取证单写作台记录，删除旧渲染组件"
```

---

### Task 15: 全量验证与文档

**Files:**
- Modify: `README.md`（Phase 段落后补一节「取证单写作台」）
- Modify: `docs/plans/2026-10-24-evidence-form-workspace-design.md`（状态改「已实施」）

- [ ] **Step 1: 跑后端全量**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest -q -p no:warnings --ignore=tests/test_archive_conflict.py --ignore=tests/test_archive_store.py --ignore=tests/test_archive_api.py`
Expected: 全部 PASS（archive 三条在 Windows 下因 dulwich 输出编码不稳定，单独跑验证）

- [ ] **Step 2: 单独跑归档三条**

Run: `cd services/agent && ./.venv/Scripts/python.exe -m pytest tests/test_archive_conflict.py tests/test_archive_store.py tests/test_archive_api.py -q -p no:warnings`
Expected: 全部 PASS

- [ ] **Step 3: 跑前端与桌面**

Run: `npm run renderer:typecheck && npm run renderer:build && npm test && npm run desktop:test`
Expected: 全部 PASS

- [ ] **Step 4: 更新 README**

在 README「Phase 8」之后新增：

```markdown
### Phase 9 · 取证单写作台（已完成）
- **新建**：选模板 + 勾疑点 → 进写作台；模板只作参考范本（不再执行 `{{占位符}}` 与 `{{#疑点}}` 循环）。
- **正文**：结构化 JSON（`.fireeye/artifacts/evidence-forms/QZ-xxxx/body.json`），模型先出大纲、
  人工确认后逐节写入，导出时才按模板骨架样式重建 docx。
- **校验**：大纲确认、章节非空、疑点编号引用在范围内、金额可在疑点快照追溯到。
- **迁移**：旧取证单产物、暂存区与回执单一并清除，报告里指向它们的快照同步移除；编号从 QZ-0001 重来。
```

- [ ] **Step 5: 提交**

```bash
git add README.md docs/plans/2026-10-24-evidence-form-workspace-design.md
git commit -m "docs(form): 取证单写作台完成，更新 README 与设计状态"
```