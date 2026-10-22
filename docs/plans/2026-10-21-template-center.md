# 模板中心 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在左侧活动栏新增「模板中心」，支持**全局 / 本项目**两个作用域的上传、管理、体检、预览 docx 模板，并提供取证单/报告示例模板。

**Architecture:** 模板作用域复用规则/模型/技能/MCP 的统一配置设计：元数据通过 `config/store` 写入 `<global_dir>/config/templates.json` 或 `<root>/.fireeye/config/templates.json`，列表通过 `load_effective` 合并，项目项覆盖同 id 全局项。模板文件放全局 `<global_dir>/templates/<kind>/` 或项目 `<root>/.fireeye/templates/<kind>/`。上传时用 `python-docx` 扫描正文、表格、页眉页脚中的占位符；示例模板是全局只读虚拟项，可按目标作用域复制为可编辑模板。

**Tech Stack:** FastAPI + python-docx + pytest、React + Zustand + Ant Design、Electron `dialog:open-files`。

**Depends on:** 无。P3 依赖本计划的模板读取、作用域解析与示例生成。

---

## 0. 范围与非目标

本计划只做：

- 活动栏新增 `templates` 入口与 `TemplatesPanel`。
- 模板的全局 / 本项目双作用域：存储、清单、上传（可多选）、重命名、删除、设默认。
- 合并列表、作用域展示（`ScopeBadge`）与筛选。
- docx 占位符体检（tags / loops / unknown / missing）。
- 示例模板生成、预览、复制到全局或本项目。
- 模板原文件预览（包括项目目录外的全局模板）。

不做：产物渲染（P3）、模板可视化编辑器、模板跨作用域移动（用复制替代）、模板版本管理。

---

## 1. 模板语法约定

本计划必须把语法固化，P3 按同一约定实现渲染。

### 1.1 字段占位符

```text
{{项目名称}}
{{被审计单位}}
{{审计期间}}
{{编制人}}
{{复核人}}
{{日期}}
```

循环内字段：

```text
{{疑点.编号}}
{{疑点.标题}}
{{疑点.描述}}
{{疑点.风险}}
{{疑点.状态}}
{{疑点.科目}}
{{疑点.金额}}
{{疑点.证据}}
{{疑点.证据数量}}
```

报告循环内：

```text
{{取证单.编号}}
{{取证单.标题}}
{{取证单.日期}}
{{取证单.疑点数量}}
{{取证单.回执}}
{{取证单.疑点摘要}}
```

> 报告只支持一层 `取证单` 循环；每份取证单的疑点用 `疑点摘要` 文本展示，不在表格行内嵌套第二层循环。报告附录可用顶层 `疑点` 循环单独列示。

### 1.2 循环

段落循环（开始/结束各占一段）：

```text
{{#疑点}}
...正文与字段...
{{/疑点}}
```

表格行循环（开始标记放在要重复的数据行第一格；结束标记单独放下一行第一格）：

```text
| {{#疑点}} | {{疑点.编号}} | {{疑点.标题}} |
| {{/疑点}} |            |              |
```

P3 的预处理器会把段落标记转换为 `{%p for ... %}`，把表格行标记转换为 `{%tr for ... %}`。

### 1.3 允许的循环名

| 模板类型 | 顶层字段 | 允许循环 |
|---|---|---|
| `evidence-form` | 项目名称、项目编号、被审计单位、审计期间、编制人、复核人、日期、取证单编号、取证单标题、疑点数量 | `疑点` |
| `report` | 项目名称、项目编号、被审计单位、审计期间、编制人、复核人、日期、报告编号、报告标题、取证单数量、疑点数量 | `取证单`、`疑点` |

> `report` 同样允许 `疑点.*` 字段（附录用顶层 `疑点` 循环单独列示）。

未知字段只警告，不阻止上传；缺失关键字段也警告，由生成界面提示。

---

## 2. 关键文件

后端：

- `services/agent/src/fireeyeaud_agent/config/store.py`（`_ID_PREFIX` 增加 `templates`）
- `services/agent/src/fireeyeaud_agent/store/templates.py`（新建）
- `services/agent/src/fireeyeaud_agent/api/templates.py`（新建）
- `services/agent/src/fireeyeaud_agent/main.py`
- `services/agent/tests/test_templates_store.py`（新建）
- `services/agent/tests/test_templates_api.py`（新建）

共享与前端：

- `packages/shared/src/types.ts`（`ActivityView`、`TemplateInfo`）
- `packages/shared/src/locales/zh-CN.ts`
- `packages/shared/src/locales/en-US.ts`
- `apps/renderer/src/lib/api.ts`
- `apps/renderer/src/store/templates.ts`（新建）
- `apps/renderer/src/components/panels/TemplatesPanel.tsx`（新建）
- `apps/renderer/src/components/templates/UploadTemplateDialog.tsx`（新建）
- `apps/renderer/src/components/templates/TemplatePreviewModal.tsx`（新建）
- `apps/renderer/src/components/ScopeBadge.tsx`（复用，不修改）
- `apps/renderer/src/components/ActivityRail.tsx`
- `apps/renderer/src/components/SideBar.tsx`
- `apps/renderer/src/env.d.ts`
- `apps/desktop/src/main.cjs`
- `apps/renderer/src/styles/global.css`

---

## Task 1: 共享类型与统一配置注册

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `services/agent/src/fireeyeaud_agent/config/store.py`

**Step 1: 共享类型**

```ts
export type TemplateKind = 'evidence-form' | 'report';

export interface TemplateCheck {
  tags: string[];
  loops: string[];
  unknown: string[];
  missing: string[];
  /** 没有 unknown 且没有 missing。 */
  ok: boolean;
}

export interface TemplateInfo {
  id: string;
  /** 与其他配置面板一致：global | project。 */
  scope: ConfigScope;
  kind: TemplateKind;
  name: string;
  fileName: string;
  /** 模板文件绝对路径；全局模板位于项目目录外。 */
  absPath: string;
  size: number;
  createdAt: string;
  updatedAt?: string;
  /** 同作用域、同 kind 内的默认模板。 */
  isDefault: boolean;
  /** 全局内置示例，不可删除，只能复制。 */
  builtin?: boolean;
  check: TemplateCheck;
}
```

> 不再使用 `relPath`。全局模板不在工作区内，渲染器无法用 `fs:read-file` 读取；统一通过后端内容接口预览。

**Step 2: 注册统一配置 kind**

`config/store.py`：

```python
_ID_PREFIX = {
    "models": "mdl",
    "db": "conn",
    "knowledge": "kb",
    "mcp": "mcp",
    "skills": "sk",
    "rules": "rule",
    "templates": "tpl",
}
```

模板元数据直接使用 `store.create_item/list_items/load_effective/update_item/delete_item/get_item`，不新增项目计数器，也不新增 `.fireeye/templates/templates.json`。

**Step 3: 类型检查**

Run: `npm run renderer:typecheck`

Expected: 仅因尚未引用新类型而通过。

**Step 4: Commit**

```bash
git add packages/shared/src/types.ts services/agent/src/fireeyeaud_agent/config/store.py
git commit -m "feat(templates): add scoped template type and config kind"
```

---

## Task 2: 模板存储、体检与示例

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/templates.py`
- Test: `services/agent/tests/test_templates_store.py`

**Step 1: 写失败测试**

测试必须覆盖全局/项目双作用域、同 id 覆盖语义、默认解析与示例复制。

```python
from pathlib import Path

from docx import Document

from fireeyeaud_agent.store.templates import (
    default_template,
    delete_template,
    duplicate_template,
    list_templates,
    scan_docx,
    template_path,
    upload_template,
)


def _docx(path: Path) -> Path:
    doc = Document()
    doc.add_paragraph("项目名称：{{项目名称}}")
    doc.add_paragraph("取证单编号：{{取证单编号}}")
    table = doc.add_table(rows=3, cols=3)
    table.cell(0, 0).text = "编号"
    table.cell(0, 1).text = "标题"
    table.cell(0, 2).text = "风险"
    table.cell(1, 0).text = "{{#疑点}}"
    table.cell(1, 1).text = "{{疑点.编号}}"
    table.cell(1, 2).text = "{{疑点.标题}}"
    table.cell(2, 0).text = "{{/疑点}}"
    doc.save(path)
    return path


def test_scan_docx(tmp_path):
    src = _docx(tmp_path / "t.docx")
    check = scan_docx(src, "evidence-form")
    assert "项目名称" in check["tags"]
    assert "疑点" in check["loops"]
    assert check["missing"] == []


def test_project_upload_list_default_delete(tmp_path, monkeypatch):
    global_dir = tmp_path / "global"
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(global_dir))
    root = tmp_path / "project"
    (root / ".fireeye").mkdir(parents=True)

    src = _docx(tmp_path / "标准取证单.docx")
    item = upload_template(
        root, src, kind="evidence-form", scope="project"
    )
    assert item["id"] == "tpl_1"
    assert item["scope"] == "project"
    assert item["isDefault"] is True
    assert (
        root / ".fireeye" / "templates" / "evidence-form" / item["fileName"]
    ).is_file()

    # 元数据进入统一配置，不生成第二份清单
    assert (root / ".fireeye" / "config" / "templates.json").is_file()
    assert not (root / ".fireeye" / "templates" / "templates.json").exists()

    items = list_templates(root, "evidence-form")
    assert any(i["id"] == item["id"] and i["scope"] == "project" for i in items)

    delete_template(root, item["id"], "project")
    assert all(i["id"] != item["id"] for i in list_templates(root, "evidence-form"))


def test_upload_can_mark_default(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "project"
    (root / ".fireeye").mkdir(parents=True)

    first = upload_template(
        root, _docx(tmp_path / "第一份.docx"), kind="report", scope="project"
    )
    second = upload_template(
        root,
        _docx(tmp_path / "第二份.docx"),
        kind="report",
        scope="project",
        is_default=True,
    )
    assert first["isDefault"] is True
    assert second["isDefault"] is True

    items = [
        i
        for i in list_templates(root, "report")
        if i["scope"] == "project" and not i.get("builtin")
    ]
    assert [i["id"] for i in items if i["isDefault"]] == [second["id"]]
    assert default_template(root, "report")["id"] == second["id"]


def test_global_and_project_scope_and_default(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "project"
    (root / ".fireeye").mkdir(parents=True)

    g = upload_template(
        root, _docx(tmp_path / "全局.docx"), kind="report", scope="global"
    )
    p = upload_template(
        root, _docx(tmp_path / "项目.docx"), kind="report", scope="project"
    )

    items = list_templates(root, "report")
    assert {i["scope"] for i in items if not i.get("builtin")} == {
        "global",
        "project",
    }
    # 两个作用域各自可以有默认；解析时项目优先
    assert default_template(root, "report")["id"] == p["id"]
    delete_template(root, p["id"], "project")
    assert default_template(root, "report")["id"] == g["id"]


def test_samples_are_global_virtual_and_copyable(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "project"
    (root / ".fireeye").mkdir(parents=True)

    items = list_templates(root, "evidence-form")
    sample = next(i for i in items if i.get("builtin"))
    assert sample["scope"] == "global"
    assert template_path(root, sample["id"], "global").is_file()

    copied = duplicate_template(
        root, sample["id"], "global", target_scope="project"
    )
    assert copied["scope"] == "project"
    assert copied["builtin"] is False
    assert template_path(root, copied["id"], "project").is_file()
```

**Step 2: 运行确认失败**

Run: `npm run agent:test -- tests/test_templates_store.py -q`

Expected: `ModuleNotFoundError: fireeyeaud_agent.store.templates`。

**Step 3: 实现存储**

目录：

```text
<global_dir>/
├─ config/templates.json
└─ templates/
   ├─ evidence-form/<tpl_id>.docx
   ├─ report/<tpl_id>.docx
   └─ samples/
      ├─ evidence-form.docx
      └─ report.docx

<项目根>/.fireeye/
├─ config/templates.json
└─ templates/
   ├─ evidence-form/<tpl_id>.docx
   └─ report/<tpl_id>.docx
```

核心函数签名：

```python
KIND = "templates"

def templates_root(scope: str, root: Path | None) -> Path
def template_file(scope: str, root: Path | None, kind: str, template_id: str) -> Path
def scan_docx(path: Path, kind: str) -> dict
def upload_template(
    root: Path | None,
    source: Path,
    *,
    kind: str,
    scope: str = "project",
    name: str | None = None,
    is_default: bool = False,
) -> dict
def list_templates(root: Path | None, kind: str | None = None) -> list[dict]
def get_template(root: Path | None, template_id: str, scope: str) -> dict | None
def resolve_template(root: Path | None, template_id: str, scope: str | None) -> dict
def update_template(
    root: Path | None,
    template_id: str,
    scope: str,
    *,
    name: str | None = None,
    is_default: bool | None = None,
) -> dict
def delete_template(root: Path | None, template_id: str, scope: str) -> bool
def default_template(root: Path | None, kind: str) -> dict | None
def template_path(root: Path | None, template_id: str, scope: str) -> Path | None
def read_template_content(root: Path | None, template_id: str, scope: str) -> tuple[bytes, str]
def ensure_samples(root: Path | None) -> list[dict]
def create_sample(root: Path | None, kind: str) -> dict
def duplicate_template(
    root: Path | None,
    template_id: str,
    scope: str,
    *,
    target_scope: str,
) -> dict
```

路径与合并：

```python
def templates_root(scope: str, root: Path | None) -> Path:
    if scope == "project":
        if root is None:
            raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
        return Path(root) / ".fireeye" / "templates"
    return store.global_config_dir().parent / "templates"
```

- `list_templates`：`store.load_effective(KIND, root)` 后过滤 `kind`；项目项已由 `load_effective` 标记 `scope="project"`，全局项为 `"global"`（对缺失 `scope` 的旧项按 `global` 兜底）。追加 `ensure_samples()` 的虚拟全局项，按 kind、默认、创建时间排序。
- 每条返回前补 `absPath = str(template_path(...))`；不要写回清单。
- `get_template` 只查指定作用域；`resolve_template` 在 `scope` 为空时按生效列表查找，供 P3 做兼容，但 UI 必须显式传作用域。

`scan_docx` 要点：

- 用 `docx.Document` 打开；收集 `doc.paragraphs`、递归 `doc.tables` 的单元格段落、每个 section 的 `header/footer` 段落。
- `TAG_RE = re.compile(r"\{\{\s*([^{}#/][^{}]*?)\s*\}\}")`
- `LOOP_RE = re.compile(r"\{\{\s*#\s*([^{}]+?)\s*\}\}")`
- 标签去掉首尾空白；循环内字段按 `prefix.field` 拆出 `prefix`。
- 已知字段表：

```python
_COMMON = {"项目名称", "项目编号", "被审计单位", "审计期间", "编制人", "复核人", "日期"}
_KNOWN = {
    "evidence-form": _COMMON | {
        "取证单编号", "取证单标题", "疑点数量",
        "疑点.编号", "疑点.标题", "疑点.描述", "疑点.风险", "疑点.状态",
        "疑点.科目", "疑点.金额", "疑点.证据", "疑点.证据数量",
    },
    "report": _COMMON | {
        "报告编号", "报告标题", "取证单数量", "疑点数量",
        "取证单.编号", "取证单.标题", "取证单.日期", "取证单.疑点数量", "取证单.回执",
        "取证单.疑点摘要",
    },
}
_REQUIRED = {
    "evidence-form": {"项目名称", "取证单编号"},
    "report": {"项目名称", "报告编号"},
}
```

`scan_docx` 返回：

```python
{
  "tags": sorted(tags),
  "loops": sorted(loops),
  "unknown": sorted(tags - known),
  "missing": sorted(required - tags),
  "ok": not unknown and not missing,
}
```

`upload_template`：

1. 校验 `scope in {"global", "project"}`；项目作用域必须有 root。
2. 校验后缀 `.docx`、大小 ≤ 20MB；先 `scan_docx`。
3. 检查目标作用域该 kind 是否已有模板；`make_default = is_default or not existing`（第一份自动默认）。
4. 调 `store.create_item(KIND, {kind, name, scope, isDefault: False}, root)` 生成 `tpl_1`。
5. 复制到 `template_file(scope, root, kind, item["id"])`，文件名用 `<id>.docx`。
6. 调 `store.update_item` 回填 `fileName/size/check`。
7. `make_default` 为真时调用 `_set_default`：清除同作用域、同 kind 的旧默认，再把目标设为默认；返回更新后的项。
8. 复制失败时删除刚创建的元数据，且不动旧默认，避免半成品。
9. 整个读写包在 `WORKSPACE_MUTATION_LOCK` 内（全局写也复用同一进程锁）。

`update_template`：

- 重命名走 `store.update_item(KIND, id, scope, {"name": name}, root)`。
- `is_default=True` 时，先遍历 `store.list_items(KIND, scope, root)`，把同 `kind` 的其他 `isDefault` 置 False，再设置目标；只影响当前作用域。
- 不允许通过 PATCH 改 `scope` 或 `kind`。

`delete_template`：

- 内置示例拒绝（`id` 在 `_SAMPLE_IDS` 中或 `builtin` 为真）。
- 删除文件（`missing_ok=True`）后 `store.delete_item(KIND, id, scope, root)`。
- 若删的是默认项，把同作用域、同 kind 的第一条设为默认。

`default_template` 解析顺序：

1. 项目作用域中 `isDefault=True` 的项。
2. 全局作用域中 `isDefault=True` 的项。
3. 项目作用域第一条。
4. 全局作用域第一条。
5. 内置示例。

`ensure_samples` / `create_sample`：

- 示例固定为全局虚拟项，不写 `config/templates.json`：

```python
{
  "id": "sample-evidence-form",
  "scope": "global",
  "kind": "evidence-form",
  "name": "取证单示例",
  "fileName": "evidence-form.docx",
  "size": ...,
  "createdAt": "...",
  "isDefault": False,
  "builtin": True,
  "check": scan_docx(...),
}
```

- 文件保存到 `<global_dir>/templates/samples/<kind>.docx`，不存在时按需生成。
- `template_path` 对 `sample-*` 返回示例路径。
- `duplicate_template` 支持源为内置示例或普通模板；复制到 `target_scope`，生成新 id，`name` 默认加「副本」，目标作用域没有同 kind 模板时设默认。

**Step 4: 示例模板**

`create_sample` 用 `python-docx` 生成：

取证单示例：

```text
标题：取证单
项目名称：{{项目名称}}
被审计单位：{{被审计单位}}
审计期间：{{审计期间}}
取证单编号：{{取证单编号}}
...
表格：
| 序号 | 疑点编号 | 疑点标题 | 风险 | 状态 | 金额 |
| {{#疑点}} | {{疑点.编号}} | {{疑点.标题}} | {{疑点.风险}} | {{疑点.状态}} | {{疑点.金额}} |
| {{/疑点}} | | | | | |
```

第一行数据行第一格写 `{{#疑点}}`，同一行其余单元格写字段；结束标记单独放下一行第一格。

报告示例：

```text
标题：项目报告
项目名称：{{项目名称}}
报告编号：{{报告编号}}
...
表格：
| 序号 | 取证单编号 | 标题 | 日期 | 疑点数量 | 回执 | 疑点摘要 |
| {{#取证单}} | {{取证单.编号}} | {{取证单.标题}} | {{取证单.日期}} | {{取证单.疑点数量}} | {{取证单.回执}} | {{取证单.疑点摘要}} |
| {{/取证单}} | | | | | | |
```

**Step 5: 运行测试**

Run: `npm run agent:test -- tests/test_templates_store.py -q`

Expected: PASS。

**Step 6: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/templates.py services/agent/tests/test_templates_store.py
git commit -m "feat(templates): add scoped template store scanner and samples"
```

---

## Task 3: 模板 API

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/api/templates.py`
- Modify: `services/agent/src/fireeyeaud_agent/main.py`
- Test: `services/agent/tests/test_templates_api.py`

**Step 1: 写失败测试**

```python
from docx import Document
import httpx
import pytest

from fireeyeaud_agent.main import app


@pytest.mark.anyio
async def test_scoped_templates_api(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "project"
    root.mkdir()
    src = tmp_path / "标准取证单.docx"
    doc = Document()
    doc.add_paragraph("{{项目名称}}")
    doc.add_paragraph("{{取证单编号}}")
    doc.save(src)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})

        uploaded = await client.post(
            "/api/v1/templates",
            json={
                "kind": "evidence-form",
                "paths": [str(src)],
                "scope": "project",
                "isDefault": True,
            },
        )
        assert uploaded.status_code == 201
        item = uploaded.json()["items"][0]
        assert item["scope"] == "project"
        assert item["name"] == "标准取证单"
        assert item["isDefault"] is True

        listed = (await client.get("/api/v1/templates?kind=evidence-form")).json()
        assert any(i["id"] == item["id"] for i in listed["items"])

        # 全局列表不包含项目项
        only_global = (
            await client.get("/api/v1/templates?kind=evidence-form&scope=global")
        ).json()
        assert all(i["scope"] == "global" for i in only_global["items"])

        patched = await client.patch(
            f"/api/v1/templates/{item['id']}?scope=project",
            json={"name": "改名", "isDefault": True},
        )
        assert patched.status_code == 200
        assert patched.json()["name"] == "改名"

        content = await client.get(
            f"/api/v1/templates/{item['id']}/content?scope=project"
        )
        assert content.status_code == 200
        assert content.json()["kind"] == "base64"
        assert content.json()["data"]

        file_res = await client.get(
            f"/api/v1/templates/{item['id']}/file?scope=project"
        )
        assert file_res.status_code == 200
        assert file_res.headers["content-type"].startswith(
            "application/vnd.openxmlformats"
        )

        sample = (await client.get("/api/v1/templates?kind=report")).json()
        sample_id = next(i["id"] for i in sample["items"] if i["builtin"])
        copied = await client.post(
            f"/api/v1/templates/{sample_id}/duplicate",
            json={"scope": "project"},
        )
        assert copied.status_code == 201
        assert copied.json()["builtin"] is False
        assert copied.json()["scope"] == "project"

        deleted = await client.delete(
            f"/api/v1/templates/{item['id']}?scope=project"
        )
        assert deleted.status_code == 200
```

**Step 2: 运行确认失败**

Run: `npm run agent:test -- tests/test_templates_api.py -q`

Expected: 404。

**Step 3: 路由**

```python
import base64
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..errors import ApiError
from ..store import templates as templates_store
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["templates"], dependencies=[Depends(require_token)])

Scope = Literal["global", "project"]


def _root_or_none() -> Path | None:
    return workspace_manager.root


class UploadBody(BaseModel):
    kind: Literal["evidence-form", "report"]
    paths: list[str]
    scope: Scope = "project"
    name: str | None = None
    # 多选时只作用于第一份，避免同作用域出现多个默认。
    isDefault: bool = False

class PatchBody(BaseModel):
    name: str | None = None
    isDefault: bool | None = None

class DuplicateBody(BaseModel):
    scope: Scope = "project"

@router.get("/templates")
def list_all(
    kind: str | None = None,
    scope: Scope | None = Query(default=None),
) -> dict:
    items = templates_store.list_templates(_root_or_none(), kind)
    if scope is not None:
        items = [i for i in items if i["scope"] == scope]
    return {"items": items}

@router.post("/templates", status_code=201)
def upload(body: UploadBody) -> dict:
    root = _root_or_none()
    if body.scope == "project" and root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    # 多选上传时使用各自文件名，避免所有项同名。
    name = body.name if len(body.paths) == 1 else None
    items = [
        templates_store.upload_template(
            root,
            Path(p),
            kind=body.kind,
            scope=body.scope,
            name=name,
            is_default=body.isDefault and index == 0,
        )
        for index, p in enumerate(body.paths)
    ]
    return {"items": items}

@router.patch("/templates/{template_id}")
def patch(
    template_id: str,
    body: PatchBody,
    scope: Scope = Query(default="global"),
) -> dict:
    patch = body.model_dump(exclude_unset=True)
    return templates_store.update_template(
        _root_or_none(),
        template_id,
        scope,
        name=patch.get("name"),
        is_default=patch.get("isDefault"),
    )

@router.delete("/templates/{template_id}")
def remove(
    template_id: str,
    scope: Scope = Query(default="global"),
) -> dict:
    templates_store.delete_template(_root_or_none(), template_id, scope)
    return {"ok": True}

@router.get("/templates/{template_id}/file")
def file(
    template_id: str,
    scope: Scope = Query(default="global"),
) -> FileResponse:
    path = templates_store.template_path(_root_or_none(), template_id, scope)
    if path is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": template_id})
    return FileResponse(path, filename=path.name)

@router.get("/templates/{template_id}/content")
def content(
    template_id: str,
    scope: Scope = Query(default="global"),
) -> dict:
    data, mime = templates_store.read_template_content(
        _root_or_none(), template_id, scope
    )
    path = templates_store.template_path(_root_or_none(), template_id, scope)
    return {
        "ok": True,
        "kind": "base64",
        "data": base64.b64encode(data).decode("ascii"),
        "mime": mime,
        "size": len(data),
        "path": str(path),
    }

@router.post("/templates/{template_id}/duplicate", status_code=201)
def duplicate(
    template_id: str,
    body: DuplicateBody,
    scope: Scope = Query(default="global"),
) -> dict:
    return templates_store.duplicate_template(
        _root_or_none(), template_id, scope, target_scope=body.scope
    )
```

- `_root_or_none()` 允许无工作区时管理全局模板；项目作用域缺少 root 时由 store 抛 `E_NO_WORKSPACE`。
- `UploadBody` 的项目作用域必须有工作区；全局作用域不需要。
- `scope` 查询参数与规则/技能一致：更新、删除必须带；列表可选，仅做筛选。
- 内容接口是全局模板预览的关键：渲染器不再假设模板在项目目录内。
- 路径检查：`template_path` 解析后必须仍在对应 `templates_root` 下；内置示例例外，固定映射到 `samples/`。

**Step 4: 注册路由**

`main.py` 的 `from .api import (...)` 加 `templates as templates_api`，并 `app.include_router(templates_api.router, prefix=API_PREFIX)`。

**Step 5: 运行测试**

Run: `npm run agent:test -- tests/test_templates_api.py -q`

Expected: PASS。

**Step 6: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/api/templates.py services/agent/src/fireeyeaud_agent/main.py services/agent/tests/test_templates_api.py
git commit -m "feat(api): add scoped templates routes"
```

---

## Task 4: 前端 API 与 Store

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `apps/renderer/src/lib/api.ts`
- Create: `apps/renderer/src/store/templates.ts`

**Step 1: `ActivityView`**

```ts
export type ActivityView =
  | 'explorer'
  | 'search'
  | 'database'
  | 'knowledge'
  | 'mcp'
  | 'skills'
  | 'rules'
  | 'models'
  | 'templates';
```

**Step 2: API 客户端**

```ts
export function listTemplates(
  kind?: TemplateKind,
  scope?: ConfigScope,
): Promise<{ items: TemplateInfo[] }> {
  const params = new URLSearchParams();
  if (kind) params.set('kind', kind);
  if (scope) params.set('scope', scope);
  const query = params.toString();
  return request(`/templates${query ? `?${query}` : ''}`);
}

export function uploadTemplates(
  kind: TemplateKind,
  paths: string[],
  scope: ConfigScope,
  isDefault = false,
): Promise<{ items: TemplateInfo[] }> {
  return request('/templates', {
    method: 'POST',
    body: JSON.stringify({ kind, paths, scope, isDefault }),
  });
}

export function patchTemplate(
  id: string,
  scope: ConfigScope,
  patch: { name?: string; isDefault?: boolean },
): Promise<TemplateInfo> {
  return request(`/templates/${id}?scope=${scope}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteTemplateApi(
  id: string,
  scope: ConfigScope,
): Promise<{ ok: boolean }> {
  return request(`/templates/${id}?scope=${scope}`, { method: 'DELETE' });
}

export function duplicateTemplateApi(
  id: string,
  scope: ConfigScope,
  targetScope: ConfigScope,
): Promise<TemplateInfo> {
  return request(`/templates/${id}/duplicate?scope=${scope}`, {
    method: 'POST',
    body: JSON.stringify({ scope: targetScope }),
  });
}

/** 全局模板在项目目录外，必须走后端内容接口。 */
export function getTemplateContent(
  id: string,
  scope: ConfigScope,
): Promise<FsFileContent> {
  return request(`/templates/${id}/content?scope=${scope}`);
}
```

**Step 3: Store**

```ts
interface TemplatesState {
  items: TemplateInfo[];
  loading: boolean;
  errorKey: string | null;
  load: () => Promise<void>;
  upload: (
    kind: TemplateKind,
    paths: string[],
    scope: ConfigScope,
    isDefault?: boolean,
  ) => Promise<void>;
  rename: (id: string, scope: ConfigScope, name: string) => Promise<void>;
  setDefault: (id: string, scope: ConfigScope) => Promise<void>;
  remove: (id: string, scope: ConfigScope) => Promise<void>;
  duplicate: (id: string, scope: ConfigScope, targetScope: ConfigScope) => Promise<void>;
  reset: () => void;
}
```

`upload` / `rename` / `setDefault` / `remove` / `duplicate` 成功后重新 `load()`。

**Step 4: 默认模板解析辅助**

在 `apps/renderer/src/lib/templates.ts`（新建）提供单一实现，生成向导与模板中心共用：

```ts
export function pickDefaultTemplate(
  items: TemplateInfo[],
  kind: TemplateKind,
): TemplateInfo | null {
  const scoped = (scope: ConfigScope) =>
    items.filter((i) => i.kind === kind && i.scope === scope && !i.builtin);
  return (
    scoped('project').find((i) => i.isDefault) ??
    scoped('global').find((i) => i.isDefault) ??
    scoped('project')[0] ??
    scoped('global')[0] ??
    items.find((i) => i.kind === kind && i.builtin) ??
    null
  );
}
```

> 与后端 `default_template` 顺序保持一致；后端始终以显式 `templateId + templateScope` 为准。

**Step 5: 类型检查**

Run: `npm run renderer:typecheck`

Expected: 会出现 `SideBar` / `ActivityRail` 缺少 `templates` 分支的错误，Task 5 修复。

**Step 6: Commit**

```bash
git add packages/shared/src/types.ts apps/renderer/src/lib/api.ts apps/renderer/src/store/templates.ts apps/renderer/src/lib/templates.ts
git commit -m "feat(templates): add scoped renderer api store and defaults"
```

---

## Task 5: 活动栏、侧栏与 Electron 文件选择

**Files:**
- Modify: `apps/renderer/src/components/ActivityRail.tsx`
- Modify: `apps/renderer/src/components/SideBar.tsx`
- Modify: `apps/renderer/src/env.d.ts`
- Modify: `apps/desktop/src/main.cjs`
- Modify: `packages/shared/src/locales/zh-CN.ts`
- Modify: `packages/shared/src/locales/en-US.ts`

**Step 1: 活动栏**

`ActivityRail.tsx` 引入 `LayoutTemplate`，`TOP_ITEMS` 在 `rules` 后加：

```ts
{ view: 'templates', icon: LayoutTemplate, labelKey: 'templates' },
```

**Step 2: 侧栏**

`SideBar.tsx`：

```tsx
import { TemplatesPanel } from './panels/TemplatesPanel';
```

`HEAD` 增加：

```ts
templates: {
  titleNs: 'templates',
  titleKey: 'title',
  subNs: 'templates',
  subKey: 'subtitle',
},
```

`PanelBody` 加 `case 'templates': return <TemplatesPanel />;`。

**Step 3: Electron 文件选择**

`main.cjs` 的 `dialog:open-files`：

```js
} else if (kind === 'templates') {
  filters = [{ name: 'Word 模板', extensions: ['docx'] }];
  title = '选择 docx 模板';
} else if (kind === 'attachments') {
```

`env.d.ts` 的 kind 联合类型加 `'templates'`。

**Step 4: 文案**

`navigation.templates`：`'模板中心'` / `'Templates'`。

新增命名空间（两个语言同步）：

```ts
templates: {
  title: '模板中心',
  subtitle: '全局 / 本项目 docx 模板：上传、体检、预览与默认模板',
  upload: '上传模板',
  uploadToGlobal: '上传到全局',
  uploadToProject: '上传到本项目',
  uploadMany: '可一次选择多个 docx',
  scope: '作用域',
  scopeAll: '全部',
  scopeGlobal: '全局',
  scopeProject: '本项目',
  evidenceForm: '取证单模板',
  report: '项目报告模板',
  empty: '暂无模板，先上传一个 docx',
  builtin: '示例',
  default: '默认',
  defaultHint: '项目默认优先于全局默认',
  setDefault: '设为默认',
  setAsDefault: '设为默认模板',
  defaultFirstHint: '多选时以第一份为默认模板',
  defaultSaved: '已设为默认模板',
  rename: '重命名',
  duplicate: '复制模板',
  duplicateToGlobal: '复制到全局',
  duplicateToProject: '复制到本项目',
  duplicateTarget: '复制到',
  preview: '预览',
  delete: '删除',
  deleteConfirm: '删除模板不会影响已生成的文档。确定删除？',
  name: '模板名称',
  checkOk: '占位符检查通过',
  checkWarn: '占位符检查有警告',
  unknown: '未识别字段：{{fields}}',
  missing: '缺少关键字段：{{fields}}',
  loops: '循环：{{fields}}',
  noLoop: '未发现循环标记',
  uploadFailed: '模板上传失败',
  sampleCopied: '已复制为可编辑模板',
  previewFailed: '模板预览失败',
},
```

`error` 命名空间加 `fileNotFound`、`fileType`、`fileTooLarge`、`fileRequired`、`templateNotFound`、`templateBuiltinReadonly`。

**Step 5: 运行类型检查**

Run: `npm run renderer:typecheck`

Expected: 可能因 `TemplatesPanel` 未创建失败；Task 6 创建。

**Step 6: Commit**

```bash
git add apps/renderer/src/components/ActivityRail.tsx apps/renderer/src/components/SideBar.tsx apps/renderer/src/env.d.ts apps/desktop/src/main.cjs packages/shared/src/locales
git commit -m "feat(templates): add activity rail entry scope copy and docx picker"
```

---

## Task 6: 模板中心 UI

**Files:**
- Create: `apps/renderer/src/components/panels/TemplatesPanel.tsx`
- Create: `apps/renderer/src/components/templates/UploadTemplateDialog.tsx`
- Create: `apps/renderer/src/components/templates/TemplatePreviewModal.tsx`
- Modify: `apps/renderer/src/styles/global.css`

**Step 1: 列表布局**

顶部作用域筛选（客户端过滤，不额外请求）：

```tsx
<Segmented
  size="small"
  value={scopeFilter}
  onChange={setScopeFilter}
  options={[
    { value: 'all', label: t('scopeAll') },
    { value: 'global', label: t('scopeGlobal') },
    { value: 'project', label: t('scopeProject') },
  ]}
/>
```

按 kind 分两组，每组标题右侧放上传按钮。上传按钮打开 `UploadTemplateDialog`，默认作用域跟随当前筛选：筛选为全局则默认全局，否则默认本项目。

```tsx
<section className="tpl-group">
  <div className="tpl-group__head">
    <span>{t('evidenceForm')}</span>
    <span className="spacer" />
    <button className="button button--sm" onClick={() => openUpload('evidence-form')}>
      <Upload size={12} /> {t('upload')}
    </button>
  </div>
  {visibleItems.map((item) => <TemplateRow ... />)}
</section>
```

**Step 2: 上传弹窗**

`UploadTemplateDialog` props：

```ts
{
  open: boolean;
  kind: TemplateKind;
  defaultScope: ConfigScope;
  onCancel: () => void;
  onUploaded: () => void;
}
```

内容：

- 单选「全局 / 本项目」，编辑时不可改（上传是新建，不存在编辑）。
- 选择文件：`window.fireeyeaud.openFiles('templates')`；显示已选文件名列表。
- 勾选「设为默认模板」；多选时提示「以第一份为默认」。
- 确认后 `uploadTemplates(kind, paths, scope, isDefault)`；成功后关闭并刷新。
- 项目作用域在没有工作区时禁用，并提示先打开项目。
- 若勾选默认，上传完成后该模板带「默认」badge；生成弹窗下次打开时默认选中它。

**Step 3: 行内容**

- 名称 + `<ScopeBadge scope={item.scope} />` + `默认` / `示例` badge。
- 体检结果：
  - `check.ok` → 绿色「占位符检查通过」。
  - 否则显示警告，列出 `unknown` / `missing`；若缺循环显示 `noLoop`。
- 操作按钮：
  - 预览。
  - 设为默认（仅非示例；同作用域内生效）。
  - 重命名（`scope` 随行传入）。
  - 复制（示例或普通模板）：弹窗选择目标作用域，默认与当前行相反的作用域。
  - 删除（非示例；`scope` 随行传入）。
- 如果同时存在项目默认与全局默认，行上均显示「默认」；顶部提示 `defaultHint`，生成时项目优先。

**Step 4: 预览弹窗**

`TemplatePreviewModal` 不使用 `readFile`，统一调用内容接口：

```tsx
const [content, setContent] = useState<FsFileContent | null>(null);
useEffect(() => {
  if (!open) return;
  void getTemplateContent(item.id, item.scope).then(setContent);
}, [open, item?.id, item?.scope]);
```

弹窗内容：

```tsx
{content?.ok && content.kind === 'base64' ? (
  <DocxPreview data={content.data} mime={content.mime} />
) : (
  <div className="panel-error">{t('previewFailed')}</div>
)}
```

`DocxPreview` 用 `lazy` 导入，避免模板面板首屏加载重依赖。

**Step 5: 样式**

```css
.tpl-toolbar { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.tpl-group { margin-bottom: 18px; }
.tpl-group__head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-weight: 600; }
.tpl-row { display: flex; flex-direction: column; gap: 4px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 6px; }
.tpl-row__top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tpl-row__name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpl-row__check { font-size: 12px; color: var(--text-muted); }
.tpl-row__check--warn { color: var(--warning); }
.tpl-row__actions { display: flex; gap: 4px; flex-wrap: wrap; }
.tpl-badge { font-size: 11px; padding: 1px 5px; border-radius: 3px; background: var(--bg-subtle); }
```

**Step 6: 手测**

Run: `npm run dev`

1. 活动栏出现「模板中心」。
2. 上传两个 docx 到本项目，列表出现两条，第一条项目默认；行上有「本项目」badge。
3. 上传一个 docx 到全局，列表出现「全局」badge；项目默认仍优先。
4. 作用域筛选「全部 / 全局 / 本项目」正确。
5. 示例模板可见、可预览、可复制到全局或本项目。
6. 体检能识别 `{{项目名称}}` 与 `{{#疑点}}`。
7. 上传时勾选「设为默认模板」，行上出现「默认」；取消勾选则沿用原默认。
8. 重命名、设默认、删除均只影响对应作用域。
9. 重新打开项目，项目模板仍在；换一个项目，全局模板仍在、项目模板不出现。

**Step 7: Commit**

```bash
git add apps/renderer/src/components/panels/TemplatesPanel.tsx apps/renderer/src/components/templates apps/renderer/src/styles/global.css
git commit -m "feat(templates): add scoped template center panel and preview"
```

---

## Task 7: 全量验证

Run: `npm run agent:test`

Run: `npm run renderer:typecheck`

Run: `npm run renderer:build`

Run: `npm run desktop:test`

Expected: 全部通过。

手工检查：

- 全局元数据在 `<global_dir>/config/templates.json`；项目元数据在 `.fireeye/config/templates.json`。
- 全局文件在 `<global_dir>/templates/<kind>/`；项目文件在 `.fireeye/templates/<kind>/`。
- 不存在 `.fireeye/templates/templates.json`，也不存在 `project.json.counters.template`。
- 上传同名文件不覆盖（文件名用 id）。
- 删除默认模板后，同作用域同类型另一条自动变默认；不影响另一作用域。
- 示例模板不写入任一 `templates.json`。
- 全局模板可在没有打开项目时预览；项目模板在项目内预览。
- 归档项目后，Git 历史包含项目模板与项目 `templates.json`，不包含全局模板。

---

## 验收标准

- 活动栏有「模板中心」，侧栏可打开。
- 可一次上传多个 docx，按取证单/报告分组。
- 模板作用域与规则/模型/技能一致：全局 / 本项目；列表显示 `ScopeBadge`，可按作用域筛选。
- 每个模板显示占位符体检结果。
- 可预览、重命名、设默认、删除、复制示例/模板到指定作用域。
- 上传弹窗提供「设为默认模板」勾选项；勾选后该模板成为对应作用域/类型的默认，生成弹窗打开时默认选中。
- 全局模板存 `<global_dir>/config/templates.json` + `<global_dir>/templates/`；项目模板存 `.fireeye/config/templates.json` + `.fireeye/templates/`。
- 同 id 项目项覆盖全局项；项目默认优先于全局默认。
- P3 可通过 `GET /templates?kind=`、`GET /templates/{id}/content?scope=` 与 `GET /templates/{id}/file?scope=` 读取模板。
