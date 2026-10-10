# 火眼审计助手 (fireeyeaud)

纯本地客户端的财务 / 会计审计助手。以 VS Code 式「打开文件夹」工作区为入口，
对工作区内的报表 / 凭证等文件进行 AI 辅助审计，产出疑点清单、证据图谱与审计工作底稿。

- **产品定位**：一个安装包双击即用；默认不联网；产物落盘在工作区 `.fireeye/`。
- **目标平台**：Windows 优先，其后 macOS / Linux。

## 架构

- **Electron 壳**：spawn / 守护 Python sidecar（随机空闲端口 + 健康检查）。
- **渲染进程**：Vite + React + TypeScript + Ant Design + Zustand。
- **Agent 服务**：FastAPI + LangGraph（仅绑 `127.0.0.1`），PyInstaller 打包为 sidecar。
- **数据**：DuckDB（分析）+ SQLite（状态 / checkpointer）。

## 目录结构

```
fireeyeaud/
├─ apps/                 # desktop（Electron 主进程）/ renderer（前端）
├─ services/agent/       # FastAPI + LangGraph sidecar（uv 管理）
├─ packages/shared/      # 前后端共享 TS 类型 + 多语言资源
└─ docs/                 # 设计文档与设计稿
```

## 开发

前置：Node ≥ 20、`uv`、Python 3.12（由 uv 自动获取）。

```bash
# 1) 安装依赖
npm install                       # JS 工作区（含 Electron）
cd services/agent && uv sync      # Agent sidecar（.venv + 依赖）

# 2) 从仓库根运行
npm run agent:test                # sidecar 冒烟测试（pytest）
npm run agent:dev                 # 单独启动 sidecar（固定 8765，热重载）
npm run desktop:dev               # 启动 Vite dev server + Electron（自动 spawn sidecar：随机端口 + 健康检查 + 退出回收）
npm run desktop:test              # Electron 壳的 sidecar 生命周期测试（node --test）
npm run renderer:build            # 构建渲染层（tsc --noEmit && vite build → apps/renderer/dist）
```

> 若 Electron 二进制下载缓慢 / 失败（GitHub Releases 受限），使用国内镜像：
> `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npx electron --version`

## 模型配置（Phase 1）

Phase 1 面向**本地 OpenAI-compatible 服务**（Ollama / vLLM），默认无需 API Key。可用环境变量覆盖：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `FIREYEAUD_MODEL_BASE_URL` | `http://127.0.0.1:11434/v1` | OpenAI-compatible 端点 |
| `FIREYEAUD_MODEL_NAME` | `qwen2.5` | 模型名 |
| `FIREYEAUD_MODEL_API_KEY` | 空（用 `not-needed`） | 云端服务鉴权 |
| `FIREYEAUD_MODEL_TEMPERATURE` | `0.2` | 采样温度 |
| `FIREYEAUD_GLOBAL_DIR` | `~/.fireeye` | 全局配置目录（Models 全局作用域） |

示例（本地 Ollama）：

```bash
FIREYEAUD_MODEL_BASE_URL=http://127.0.0.1:11434/v1 FIREYEAUD_MODEL_NAME=qwen2.5 npm run desktop:dev
```

未配置或模型不可达时，对话会返回 `error.llmUnavailable` 提示而非崩溃。

## 状态

### Phase 1 · MVP 最小闭环（已完成）
工作区打开、Excel/CSV 导入（SSE 进度）、审计工具（describe_source / sql_query /
aggregate_subject / parse_ledger / check_tie）、对话 Agent（plan → tool_call → reflect，
产出疑点）、疑点清单、工作区关键词搜索、Models 面板（global/project 作用域）。

### Phase 2 · 证据与复核（已完成）
- **证据链**：每次工具调用/结果写 `.fireeye/evidence.jsonl`，SHA-256 哈希链
  （`hash = sha256(prevHash + canonical)`）；大结果（>16KB）落 `.fireeye/artifacts/ev_<seq>.json`；
  打开工作区时校验链完整性；`GET /evidence`、`POST /workspaces/{id}/verify-evidence`。
- **疑点复核**：`POST /findings/{id}/review`（确认/驳回/复核中/误报/备注/改级别），
  事件追加到 `findings.jsonl`；前端疑点卡片可展开证据链与复核记录。复核人暂为占位「审计员」。
- **规则库**：内置 `tie_check`（代码检测器）+ `related_party_undisclosed`（prompt 规则）
  可启停/覆盖 severity；项目自定义规则（`rules.jsonl` 事件流，`R-<n>`）CRUD；
  `POST /rules/{id}/run` 干跑预览、`POST /rules/run` 批量产出疑点；启用的 prompt 规则注入 Agent 系统提示词。

### Phase 3 · 证据图谱可视化（已完成）
- **后端派生**：`GET /graph?findingId` 由 `findings` + `evidence` + `schema` **实时派生**
  `{nodes, edges}`（不落盘）；节点 `finding` / `dataset` / `voucher` / `rule` / `tool`，
  边 `derived_from` / `references` / `verified_by`；节点 id `<nodeType>:<refId>`。
- **前端图谱**：成果栏「证据图谱」tab 用 Cytoscape.js 渲染（≤30 节点用 `breadthfirst`，
  否则 `cose`）；点击节点弹详情卡，点击疑点节点「查看疑点」跳回清单并选中；
  疑点列表选中某条时图谱聚焦/高亮其子图。

### Phase 4 · 审计底稿导出（已完成）
- **生成**：`store/working_paper.py` 由疑点 + 证据 + 工作区信息生成
  **Word（python-docx）/ Excel（openpyxl）/ PDF（reportlab + 内置 CJK 字体 `STSong-Light`）**；
  结构为封面 / 审计结论 / 疑点汇总 / 证据索引 / 附录；产物落
  `.fireeye/artifacts/working-paper/wp_<n>/`（文档 + `manifest.json`）。
- **REST**：`POST /export/working-paper {findingIds?, format, locale, templateId?}`、
  `GET /export/working-paper`（历史）、`GET /artifacts/{path}`（读取产物，含目录穿越防护）。
- **前端**：成果栏「底稿预览」tab 导出并列出历史产物，经 Electron `shell` IPC「打开文件」/「在文件夹中显示」。

### Phase 5 · 数据库连接（只读直连）（已完成）
- **连接管理**：活动栏「数据库连接」面板配置只读连接（SQLite / PostgreSQL / MySQL / SQL Server / Access）；
  元数据存 `db.json`（global/project 作用域合并），密码单独存 `<global_dir>/config/db_secrets.json`（不入项目库）。
- **反射与授权**：`POST /db/connections/{id}/reflect` 反射表结构 → 写 `index/schema.json` 并注册为数据源；
  `PATCH /db/connections/{id}/authorization` 保存表 / 字段白名单（`.fireeye/authorization.json`）。
- **Agent 查询**：`sql_query` 增 `sourceId`，命中 DB 源时经 SQLAlchemy 只读连接执行，
  用 sqlglot 强制表级 / 显式列级授权（`E_DB_UNAUTHORIZED`）；`describe_source` 对 DB 源按授权过滤列。

已知偏差（详见 [`docs/plans/2026-10-09-phase1-mvp.md`](docs/plans/2026-10-09-phase1-mvp.md)、
[`docs/plans/2026-10-09-phase2-evidence-review.md`](docs/plans/2026-10-09-phase2-evidence-review.md)、
[`docs/plans/2026-10-09-phase3-evidence-graph.md`](docs/plans/2026-10-09-phase3-evidence-graph.md)、
[`docs/plans/2026-10-09-phase4-working-paper-export.md`](docs/plans/2026-10-09-phase4-working-paper-export.md)、
[`docs/plans/2026-10-09-phase5-database-connections.md`](docs/plans/2026-10-09-phase5-database-connections.md)）：
工具先用进程内 LangChain `StructuredTool`；搜索先用主进程 Node 遍历；模型密钥暂只支持
无 key / 环境变量；DB 凭据明文存本机 `db_secrets.json`（safeStorage 推迟 Phase 6）；
会话/消息投影为简化实现；证据仅记 tool_call/tool_result 两档；打开工作区同步校验证据链；
图谱 `subject`/`party` 节点推迟；主题切换后需重挂 tab 才更新图谱配色；
底稿仅内置默认模板（不读 `.fireeye/templates/`），产物目录用 `wp_<n>`；
DB 只读依赖 SQL 白名单（非数据库侧强制），字段级授权为 best-effort（`SELECT *` 不裁剪返回列）。
真实模型 / 非 SQLite 数据库 E2E 需人工按计划步骤验证。

## 文档

- 设计文档：[`docs/plans/fireeyeaud-design.md`](docs/plans/fireeyeaud-design.md)
- UI 设计说明：[`docs/design/设计说明.md`](docs/design/设计说明.md)
