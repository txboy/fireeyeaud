# 后端（Python sidecar）

> English: [../en/02-backend.md](../en/02-backend.md)

`services/agent/` 下是一个 FastAPI 应用，只监听 `127.0.0.1`，由 Electron 主进程拉起。

## 分层

```
api/       HTTP 层 —— 解析请求、校验参数、把异常转成统一错误包裹
  │
  ├─→ agent/   Agent 层 —— LangGraph 图、系统提示词、上下文压缩、各类对话流
  │     │
  │     └─→ tools/  工具层 —— Agent 能调用的能力（12 个内置工具）
  │
  └─→ store/   持久化层 —— JSONL 事件流、DuckDB、文件、加密、Git 归档
        ↑
        └── tools/ 也调 store/，不直接碰文件
```

**分层规则**：

- `api/` 只做协议转换，不放业务逻辑。它调用 `store/` 或 `agent/`。
- `store/` 不知道 HTTP 存在，也不知道 Agent 存在。它是纯函数 + 文件/数据库操作。
- `tools/` 是 Agent 和 `store/` 之间的桥，每个工具就是一个 `(root, params) -> dict` 函数。
- 跨层不要反向依赖：`store/` 里 `import api.` 是错的。

## 应用装配

`main.py` 把 20 个 router 统一挂到 `/api/v1`：

```python
API_PREFIX = "/api/v1"

def create_app() -> FastAPI:
    ...
    app.include_router(sessions.router, prefix=API_PREFIX)
    ...
```

每个 router 自己声明 `tags` 和鉴权依赖：

```python
router = APIRouter(tags=["findings"], dependencies=[Depends(require_token)])
```

`require_token`（`api/deps.py`）只在设置了 `FIREYEAUD_TOKEN` 时才校验 `Authorization: Bearer <token>`；开发环境不设就放行。生产环境由 Electron 主进程生成随机 token 注入环境变量。

## 错误约定

全后端只有一个错误类型：`ApiError(code, http_status, message_key, params)`。

```python
raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": finding_id})
```

- `message_key` 是**前端用来翻译的 key**，形如 `error.notFound`，必须在中英文案里都存在。
- 不要再用 `error.internal`。它在阶段 B 已被 9 处语义化 key 替换，并有回归测试守着（`tests/test_error_codes.py`）。
- 抛出的异常由统一处理器转成 JSON 包裹，前端 `client.ts` 的 `toApiError` 会把它还原成 `ApiError`。

新增错误码时：`packages/shared/src/locales/zh-CN.ts` 与 `en-US.ts` 都要加，否则界面会显示原始 key。

## Agent 层

`agent/graph.py` 是核心，跑一个 `planning → executing → reflecting` 的循环：

```python
event("status", {"phase": "planning"})
yield event("context", {"options": options})    # 本次实际带上的资源快照
yield event("token", {"delta": piece})          # 流式正文
yield event("tool_call", {...})                 # 工具调用
yield event("tool_result", {...})               # 工具结果摘要
yield event("done", {"usage": ...})             # 结束
```

几个关键文件：

| 文件 | 职责 |
|---|---|
| `agent/graph.py` | 主循环、事件发射、工具调度 |
| `agent/prompts.py` | 系统提示词组装（含注入的自定义规则、技能目录） |
| `agent/compaction.py` | 上下文压缩（长对话裁剪 + 摘要） |
| `agent/token_budget.py` | 裁剪策略：工具结果进模型前先限量 |
| `agent/context_snapshot.py` | 生成给前端展示的"本次带了什么" |
| `agent/sql_assistant.py` | SQL 助手的独立对话流 |
| `agent/report_agent.py` / `form_agent.py` | 报告 / 取证单写作对话 |
| `agent/attachment_reader.py` | 临时附件抽取（含扫描件走视觉模型） |

**安全前提**：工作区文件内容一律视为不可信数据，绝不当作指令。提示词里明确写了这条，改动提示词时不要删。

## 工具

`tools/` 下 12 个内置工具，每个都是 `fn(root: Path, params: dict) -> dict`：

| 工具 | 用途 |
|---|---|
| `list_files` | 列目录树 |
| `search_files` | 按 glob 或内容关键词检索 |
| `read_file` | 读文件（文本/表格/docx/PDF；图片与扫描件需视觉模型） |
| `describe_source` | 查看表结构（构造 SQL 前必须先调） |
| `sql_query` | 只读 SQL，走沙箱 |
| `run_rule` | 跑一条已保存的自定义 SQL 规则 |
| `parse_ledger` | 凭证表 → 标准凭证行 |
| `aggregate_subject` | 按科目汇总借贷与余额 |
| `check_tie` | 科目勾稽／表级借贷平衡 |
| `report_finding` | 记录疑点（由 graph 拦截，不直接返回） |
| `kb_search` | 检索已启用知识库 |
| `load_skill` | 按 id 取技能正文 |
| `web_search` | 联网搜索（仅设置页开启后才注册） |

### 权限注入机制

工具本身不判断权限，权限由 `registry.build_tool_dict(context=...)` 注入：

```python
# registry._context_wrapper 会给特定工具补上白名单
if fn in (sql_query, run_rule):
    merged["allowedConnectionIds"] = context["allowedConnectionIds"]
elif fn is kb_search:
    merged["allowedProviderIds"] = context["allowedProviderIds"]
elif fn is load_skill:
    merged["allowedSkillIds"] = context["allowedSkillIds"]
```

`context` 由会话的"默认 ∪ 勾选"计算而来。工具内部拿这个白名单做最终校验——**不要只在前端拦**，前端只是体验层。

`web_search` 特殊：它不在固定列表里，只有当设置里 `webSearch.enabled` 为真时才被注册进工具字典。也就是说关闭时模型根本看不到这个工具。

## 持久化层

`store/` 是最大的目录。几条约定：

- **事件流用 JSONL**：疑点（`findings.jsonl`）、证据（`evidence.jsonl`）都是追加写，读的时候回放事件得到当前状态。不做原地修改。
- **大结果落 artifacts，有两处**：
  - 证据事件的结果超过 16KB（`store/evidence.py` 的 `_ARTIFACT_THRESHOLD`）时，完整结果写 `.fireeye/artifacts/ev_<seq>.json`，事件里只留 `artifactRef`。
  - `sql_query` 命中行数上限被截断时，完整结果写 `.fireeye/artifacts/query_<8位hex>.json`，返回值带 `artifactRef`。
  - `tools/base.py` 的 `dump_artifact` 只是写入工具，是否落盘由调用方判断。
- **写文件走 `fsutil.write_json_atomic`**：先写临时文件再替换，避免断电留半截 JSON。
- **工作区变更要拿锁**：`WORKSPACE_MUTATION_LOCK`。跨数据库往返的操作放在锁外，落盘操作放进锁内。
- **DuckDB 用于分析，SQLite 用于状态**：`workspace.duckdb` 存导入的表格；`checkpoints.sqlite` 存会话消息投影。

## 测试

```bash
npm run agent:test      # pytest，116 个测试文件
npm run agent:lint      # ruff
```

测试用 `httpx.ASGITransport` 直连 app，不起真实端口：

```python
transport = httpx.ASGITransport(app=app)
async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
    ...
```

## 改后端的自查清单

- [ ] 新错误码在中英两套 locale 里都有
- [ ] 没有引入 `error.internal`
- [ ] `store/` 没有反向依赖 `api/` 或 `agent/`
- [ ] 写文件用了 `write_json_atomic`，变更拿了锁
- [ ] 工具有权限校验，且校验基于 `context` 而不是信任前端
- [ ] `npm run agent:test` 与 `npm run agent:lint` 都过