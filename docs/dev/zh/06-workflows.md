# 常见任务

> English: [../en/06-workflows.md](../en/06-workflows.md)

每节是一个可以照做的清单。命令都在仓库根执行，除非另注。

## 第一次跑起来

```bash
npm install                      # JS 工作区（含 Electron）
cd services/agent && uv sync     # Python 依赖，uv 会拉好 3.12
cd ../..
npm run desktop:dev              # 起界面 + 自动拉起 sidecar
```

跑不起来时按这个顺序查：

1. `npm run agent:dev` 能否单独启动？不能 → Python 环境问题
2. 浏览器打开 `http://127.0.0.1:8765/api/v1/health` 有没有 `{"status":"ok"}`？
3. 界面停在「正在启动 Agent 服务」→ 看主进程控制台的 `[sidecar]` 日志
4. 弹「连不上本地后端」→ 端口冲突或 sidecar 已崩溃，重启 `npm run desktop:dev`

---

## 加一个 Agent 工具

以加一个 `check_vat`（校验增值税勾稽）为例。

**1. 写工具函数** `tools/check_vat.py`：

```python
"""check_vat：校验进项销项税额勾稽。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

def check_vat(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    table = params.get("table")
    # ... 用 DuckDB 查询
    return {"ok": True, "diff": 0}
```

**2. 注册** `tools/registry.py`：

```python
from .check_vat import check_vat

class CheckVatArgs(BaseModel):
    table: str = Field(description="表名")

_SPECS = [
    ...
    ("check_vat", "校验进项销项税额勾稽。", check_vat, CheckVatArgs),
]
```

**3. 写进系统提示词** `agent/prompts.py` 的 `_BASE`，加一行说明。**不加这行，模型不知道有这个工具。**

**4. 补测试** `tests/test_check_vat.py`，参考现有工具测试的写法（`httpx.ASGITransport` 或直接调函数）。

**5. 验证**

```bash
npm run agent:test
npm run agent:lint
```

**不需要改前端**——工具调用结果以 `tool_result` 事件自动流到界面。

> 如果工具需要权限控制，参考 `_context_wrapper` 里 `sql_query` / `kb_search` 的写法，从 `context` 注入白名单，并在工具内部做最终校验。

---

## 加一个 REST 接口

以「导出疑点 CSV」为例。

**1. 后端** `api/findings.py`：

```python
@router.get("/findings/export.csv")
def export_findings_csv() -> Response:
    root = _root()
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 400, "error.noWorkspace")
    ...
```

约定：

- 抛 `ApiError`，不要自己拼错误 JSON
- 错误文案的 key 要同时加进 `zh-CN.ts` 和 `en-US.ts` 的 `error` 命名空间

**2. 共享类型**（如果前端要用）`packages/shared/src/types.ts`

**3. 前端封装** `apps/renderer/src/lib/api/findings.ts`：

```ts
export function exportFindingsCsv(): Promise<Blob> { ... }
```

**4. 前端调用** 在 store 里加动作，失败时 `errorKey: errorKeyOf(err)`。

**5. 验证**

```bash
npm run agent:test && npm run agent:lint
cd apps/renderer && npx tsc --noEmit
```

---

## 加一个配置实体（比如「凭证模板」）

配置类实体都走同一套 `config/store.py`，加一个 `kind` 即可：

1. `api/` 下新建 router，实现 `GET/POST/PATCH/DELETE`，内部调 `config.store.list_items/create_item/update_item/delete_item`
2. `main.py` 里 `app.include_router(xxx.router, prefix=API_PREFIX)`
3. `packages/shared/src/types.ts` 定义类型
4. `apps/renderer/src/lib/api/` 加领域模块
5. 前端：`store/` 加 store、`components/panels/` 加面板、`components/forms/` 加表单
6. `ActivityRail.tsx` 的 `TOP_ITEMS` 加条目（如果要出现在活动栏）

注意 scope：`global ⊕ project` 合并，`project` 覆盖 `global`。

---

## 加一个右侧 tab

1. `store/ui.ts`：`RightTab` 联合类型加一个 kind
2. `store/ui.ts`：加 `openXxx()` 动作（参考 `openReport`）
3. `components/RightArea.tsx`：加渲染分支（注意标题和关闭确认两处都要加）
4. 如果需要离开守卫（未保存内容），接进 `allowLeave` 机制

---

## 加一个导出格式

导出集中在 `store/working_paper.py`（底稿）和 `store/report_docs.py` / `docx_render.py`（报告、取证单）。

1. 加渲染函数（现有 `_render_docx` / `_render_xlsx` / `_render_pdf` 可参考）
2. `_FILE` 映射加文件名
3. 请求体的 `format` 枚举（`packages/shared/src/types.ts` 的 `WorkingPaperFormat`）加值
4. 前端 `WorkingPaperView.tsx` 的 `FORMATS` 加按钮
5. 跑 `npm run agent:test`

**PDF 中文**：用 reportlab 时靠内置的 `STSong-Light` 字体，不要引入外部字体文件（打包会丢）。

---

## 加一个文件预览格式

1. `apps/desktop/src/file-preview.cjs`：加扩展名 → 类型判断
2. `apps/renderer/src/components/preview/` 加组件
3. `WorkspacePreview.tsx` 加分支
4. 重依赖用动态 `import()`，别进主 bundle
5. 写文本文件的格式还要加进主进程的写白名单

---

## 调试 sidecar

**看日志**：`npm run desktop:dev` 的主进程控制台会带 `[sidecar]` 前缀输出。

**单独启动**（推荐，改后端时热重载）：

```bash
npm run agent:dev          # 固定 8765
# 另一个终端
npm run desktop:dev
```

**直接调接口**：

```powershell
# 开发环境没设 FIREYEAUD_TOKEN，不用带 Authorization
curl "http://127.0.0.1:8765/api/v1/health"
curl "http://127.0.0.1:8765/api/v1/findings"
```

**看 OpenAPI**：浏览器打开 `http://127.0.0.1:8765/docs`。

**sidecar 启动很慢**：主进程默认等 120 秒、每 500ms 探一次；首次导入依赖、杀毒软件扫描、大工作区索引都可能拖慢。诊断方法见 `docs/plans/2026-10-27-startup-performance.md`。

---

## 排查常见现象

| 现象 | 先看哪里 |
|---|---|
| 界面显示 `error.xxx` 原文 | 该 key 没加进对应 locale |
| 「连不上本地后端」 | sidecar 崩了或端口被占；看主进程日志 |
| 「正在启动 Agent 服务」不动 | `_waitReady` 还在探测；直接 curl health |
| 证据链校验失败 | 有人手改了 `evidence.jsonl`；用 `verify-evidence` 定位 `breakAt` |
| 工作区打不开、报 schema 版本过高 | `.fireeye/project.json` 的 `schemaVersion` 比程序新 |
| 模型不可达 | 检查 base URL、模型名；`POST /models/{id}/test` |
| 数据库查询报未授权 | `authorization.json` 的表/列白名单 |
| 前端某处报模块找不到（node 单测） | 相对导入缺 `.ts` 后缀 |

---

## 提交前必跑

```bash
npm run agent:lint        # ruff
npm run agent:test        # pytest
npm run desktop:test      # Electron 壳
cd apps/renderer
npx tsc --noEmit
node --experimental-transform-types --test tests/*.test.ts
cd ../.. && npm run renderer:build
```

---

## 改文档

- 改的是**当前实现** → 改 `docs/dev/`（本目录）
- 改的是**历史决策** → 不要动 `docs/plans/`，那是对过去的记录

写进文档的行为细节（端口、上限、文件名、错误码）写之前先回代码确认一遍——这些值会变，文档容易过时。