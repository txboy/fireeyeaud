# 火眼审计助手 (fireeyeaud) — 设计文档

- 日期：2026-10-09
- 状态：已确认，待进入实现
- 英文名：`fireeyeaud`

## 1. 产品定位

一款**纯本地客户端**的财务/会计审计助手。以 VS Code 式的「打开文件夹」工作区为入口，
对工作区内的报表/凭证等文件进行 AI 辅助审计，产出疑点清单、证据图谱与审计工作底稿。

- 无需独立部署：一个安装包双击即用，内部进程对用户透明。
- 数据敏感：默认不联网，全部产物、中间件、缓存均落盘在工作区内的 `.fireeye/` 目录。
- 模型混合可配置：通过 OpenAI-compatible 接口接入本地（Ollama/vLLM）或云端模型。

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                 Electron Shell (main.cjs)                    │
│  - spawn / 守护 Python sidecar（随机空闲端口 + 健康检查）    │
│  - 窗口管理、IPC 白名单、安全策略                            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  渲染进程 (React + TypeScript + Ant Design)           │  │
│  │  ├── 标题栏 / 活动栏 / 资源管理器目录树               │  │
│  │  ├── 中间 Agent 对话栏 / 右侧成果栏(tab 切换)         │  │
│  │  ├── 自然语言输入 → SSE 流式接收 Agent 输出           │  │
│  │  └── 人工复核操作（确认/驳回/标记）                   │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │ HTTP / SSE (127.0.0.1)            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Agent 服务 (FastAPI, 仅绑定 127.0.0.1)               │  │
│  │  ├── Session Manager：项目级会话隔离                   │  │
│  │  ├── ReAct Engine (LangGraph)：Plan→Execute→Reflect   │  │
│  │  ├── Tool Registry：MCP 工具发现与调用                │  │
│  │  └── Evidence Logger：全链路操作记录                   │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │ OpenAI-compatible API             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  模型服务（本地 Ollama/vLLM 或云端，可配置）           │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 3. 技术选型

| 层 | 选型 | 说明 |
|---|---|---|
| 桌面壳 | Electron + electron-builder | 单安装包双击即用 |
| 渲染进程 | Vite + React + TypeScript | — |
| UI 组件库 | Ant Design | 表格/树/表单强，适合审计密集界面 |
| 状态管理 | Zustand | 轻量 |
| 图谱可视化 | Cytoscape.js | 关系图/力导布局成熟 |
| Agent 服务 | FastAPI + uvicorn（127.0.0.1） | 通过 PyInstaller 打包为 sidecar |
| 流式输出 | sse-starlette | SSE 事件流 |
| Agent 引擎 | LangGraph | StateGraph: plan→tool_call→reflect；checkpointer 做会话隔离 |
| MCP 接入 | langchain-mcp-adapters | MCP Server → LangChain tools |
| 分析存储 | DuckDB | 进程内直接查 Excel/CSV/Parquet |
| 状态存储 | SQLite | LangGraph checkpointer / 会话 |
| 日志 | JSONL（append-only） | findings / evidence / rules，便于 diff 回溯 |
| 模型接入 | openai SDK（OpenAI-compatible） | 本地或云端同一接口 |
| 国际化 | i18next + react-i18next + ICU MessageFormat | 前端文案；Ant Design `ConfigProvider` locale 联动 |
| 文件搜索 | ripgrep（捆绑二进制，Electron 主进程执行） | 工作区内关键词搜索，含 glob 过滤与分组；经 IPC 调用，不走 HTTP |
| 数据库连接 | SQLAlchemy（只读）+ 各库驱动 | 统一连接、表结构反射、表 / 字段授权 |
| 技能包 | 内置 + 用户自定义（提示词 + 工具组合） | Skills 面板管理 |
| 审计规则 | 内置规则库 + 项目自定义 | SQL / prompt 检测器，管理入口见设置页「规则库」 |
| 知识库接入 | Dify / RAGFlow Knowledge API（适配器） | **仅检索**；Provider 适配器归一化（§14.19） |
| 配置作用域 | 全局 `~/.fireeye/config` + 项目 `.fireeye/config` | 配置项可选 `global` / `project`（§14.20） |
| 契约校验 | zod（TS）/ Pydantic（Py） | 运行时 schema 校验，契约测试（§19） |
| E2E 测试 | Playwright（Electron） | 关键用户流程回归（§19） |
| 自动更新 | electron-updater | 可选渠道，离线可禁用（§21） |

### 为何保留 Python
Excel 解析、pandas/DuckDB、LangGraph 的 Python 生态在本项目明显强于 Node 方案。
代价是安装包体积增大（Python 运行时 + 依赖）、构建链需同时维护 Node 与 Python 两套，
以及 PyInstaller sidecar 首次冷启动较慢。此代价换取「双击即用 + Python 数据生态」。

## 4. 工作区模型（VS Code 式）

- 用户「打开文件夹」即建立一个**工作区**（一个审计项目），文件夹内文件即审计对象。
- 打开时初始化 `.fireeye/` 目录（对标 `.git/`），随项目走、可拷贝、可纳入版本控制。
- 全部输出、中间内容、缓存均写入 `.fireeye/`。

```
.fireeye/
├─ project.json         # 项目元信息（schemaVersion、counters、数据源）
├─ config/              # 项目级配置（作用域=project 的 models/mcp/skills/knowledge/db）
├─ workspace.duckdb     # 导入数据（一项目一库）
├─ findings.jsonl       # 疑点事件流（append-only）
├─ evidence.jsonl       # 证据事件流（append-only + 哈希链）
├─ rules.jsonl          # 项目自定义审计规则
├─ checkpoints.sqlite   # LangGraph checkpointer，会话隔离与断点续跑
├─ authorization.json   # 数据库表 / 字段授权清单
├─ templates/           # 底稿模板
├─ index/               # schema.json（结构摘要）、files.json（文件指纹）
└─ artifacts/           # 工具大结果、图谱 / 底稿导出
```

- **全局配置与日志**位于用户主目录 `~/.fireeye/`（Windows：`%USERPROFILE%\.fireeye\`）：`config/`（作用域=global 的配置）、`logs/`；不随项目走、跨工作区共享（见 §14.20）。

## 5. 目录结构（monorepo）

```
fireeyeaud/
├─ apps/
│  ├─ desktop/          # Electron 主进程 + preload
│  └─ renderer/         # Vite + React + Ant Design
├─ services/
│  └─ agent/            # FastAPI + LangGraph + MCP
│     ├─ api/           # 路由: workspaces, datasources, db, kb, mcp, skills, models,
│     │                 #       rules, sessions/chat(SSE), findings, evidence, graph,
│     │                 #       export, settings, artifacts
│     ├─ agent/         # graph 节点、状态定义、prompts
│     ├─ tools/         # 自建 MCP 工具实现
│     ├─ kb/            # 知识库 Provider 适配器（dify / ragflow）
│     ├─ mcp/           # MCP Server 注册与发现
│     ├─ store/         # 状态存储（checkpointer / 会话 / 索引）
│     └─ config/        # 配置作用域（global/project）解析与 provider 配置
├─ packages/
│  └─ shared/           # 前后端共享 TS 类型（SSE 事件、疑点结构）
│     ├─ locales/       # 多语言资源
│     │  ├─ zh-CN/{common,enums,navigation,explorer,search,database,knowledge,mcp,skills,models,rules,findings,agent,evidence,working-paper,settings}.json
│     │  └─ en-US/{common,enums,navigation,explorer,search,database,knowledge,mcp,skills,models,rules,findings,agent,evidence,working-paper,settings}.json
│     └─ ...
└─ docs/plans/
```

## 6. UI 布局（最终稿）

详见 `docs/design/设计说明.md`（含 7 屏预览图与设计令牌）。

```
┌──────────────────────────────────────────────────────────────────────┐
│ 标题栏：品牌 · 项目名 · 窗口控制                                      │
├──────┬──────────────┬──────────────────────────┬─────────────────────┤
│ 活动 │ 资源管理器    │  Agent 对话栏（主区域）   │  成果栏              │
│ 栏   │ 目录树        │  头部 / 消息流 / 输入框   │  tab: 疑点/图谱/底稿/│
│      │              │                          │  日志                │
├──────┴──────────────┴──────────────────────────┴─────────────────────┤
│ 状态栏：工作区 · 疑点数 · 数据引擎 · 模型 · 版本                      │
└──────────────────────────────────────────────────────────────────────┘
```

- **标题栏**：品牌 / 项目名 / 窗口控制。
- **活动栏**（窄图标条）：资源管理器 / 搜索 / 数据库连接 / 知识库 / MCP / Skills / Models；底部 主题 / 设置。
  （疑点清单 / 证据图谱 / 底稿预览 / 证据日志 不再是活动栏项，改为成果栏内 tab。）
- **资源管理器侧栏**（点击「资源管理器」展开）：工作区名 + 文件目录树（含 `.fireeye/`、底稿、数据文件），支持展开/折叠。
- **中间 Agent 对话栏**（主区域）：Agent 头部 + 消息流（推理步骤 / 结果卡片 / 追问建议）+ 输入框（附件 / 选择工具 / 联网 + 发送），SSE 流式。
- **右侧成果栏**：顶部 tab 切换 疑点清单 / 证据图谱 / 底稿预览 / 证据日志；疑点清单含风险统计 + 过滤条 + 疑点卡片列表。
- **状态栏**：工作区状态 / 疑点数 / 数据引擎 / 模型 / 版本。
- 设置页含「外观与语言」「规则库」「联网检索」「数据与存储」「关于」等全局选项（模型配置见活动栏 **Models**）。

### 活动栏功能（7 项）

点击活动栏图标，左侧展开对应的功能面板（侧栏）。各项配置均支持**作用域**（全局 / 本项目，见 §14.20）。

1. **资源管理器**：工作区文件目录树（含 `.fireeye/`、数据文件、底稿），支持展开 / 折叠与新建。
2. **搜索**：对工作区内文件做关键词搜索（VS Code 式）；支持包含 / 排除 glob、大小写 / 正则选项、按文件分组展示命中行、点击定位与预览。由 **Electron 主进程 spawn ripgrep** 执行，经 IPC 调用（不走 HTTP）。
3. **数据库连接**：配置只读数据库连接（SQLite / MySQL / PostgreSQL / SQL Server 等，凭据安全存储）；连接后可在对话中选择数据源，并**限定 Agent 可访问的表与字段**（授权清单，落盘于 `.fireeye/`）。
4. **知识库**：接入 Dify / RAGFlow（仅检索，见 §14.19）——配置连接（base URL + API key）、测试连通、浏览远端知识库并勾选启用；Agent 经 `kb_search` 工具检索命中片段用于 RAG。
5. **MCP**：管理 MCP Server（增删 / 启停 / 连接状态 / 工具列表 / 权限与沙箱范围）。
6. **Skills**：管理技能包（内置与自定义的提示词 + 工具组合，启停与参数配置）。
7. **Models**：管理模型配置（provider / base_url / api_key / model / 参数），支持多套配置并指定默认；原「设置页模型配置」并入此处。

底部保留 **主题** 与 **设置**（全局选项：外观与语言 / 规则库 / 联网检索 / 数据与存储 / 关于）。

## 7. 核心数据流

1. 导入 Excel/CSV：渲染进程经 IPC 请主进程弹出系统文件框并校验路径（主进程持有文件系统权限）→ 渲染进程把路径 `POST /datasources/import` 给 sidecar → sidecar 读取文件解析入 DuckDB（仅原始表 `src_*`），schema 摘要写 `.fireeye/index/schema.json`、文件指纹写 `index/files.json`；导入进度经 SSE 回推（复用 §14.7 信封，`type=import_progress`）。
2. 用户自然语言提问 → `POST /sessions/{id}/chat` → LangGraph `astream_events` → SSE 事件流。
3. Agent 在 `tool_call` 节点调 MCP 工具（DuckDB 查询、勾关系、知识库检索等），每步追加 Evidence Logger（含哈希链）。
4. 产出疑点 → 以事件追加到 `.fireeye/findings.jsonl` → SSE 推 `finding` → 前端疑点列表刷新。
5. 人工复核（确认 / 驳回 / 标记）→ 以事件追加到 `.fireeye/findings.jsonl`，并追加证据日志。

### SSE 事件协议（前后端契约，定义于 `packages/shared`）
事件类型见 §14.7：`status` / `thinking` / `tool_call` / `tool_result` / `token` / `finding` / `import_progress` / `error` / `done` / `heartbeat`。

### LangGraph 状态定义（`StateGraph`）

```
State = {
  messages:   Annotated[list[Message], add_messages],  // 对话历史
  locale:     str,                                     // 生成语言
  projectId:  str, sessionId: str,
  sources:    list[SourceRef],                         // 本会话可用/已授权数据源
  plan:       list[Step],  stepIndex: int,             // plan 节点产出
  findings:   list[FindingDraft],                      // 本轮累计疑点
  evidence:   list[EvidenceDraft],                     // 待落盘证据
  error:      Error | None,
}
```

- 节点：`plan → tool_call → reflect`，`reflect` 决定回到 `tool_call` 或结束；`route` 条件边。
- `checkpointer` 按 `thread_id = sessionId` 隔离，支持断点续跑。
- **循环治理**：`maxSteps`（默认 12 步）与单轮超时（默认 5 分钟）；达到任一上限即强制进入结束并回 `done`，附提示（`E_AGENT_LIMIT`）。
- **上下文治理**：接近模型窗口时按「最近消息 + 历史摘要」截断；摘要作为 `llm_output` 证据落盘；工具大结果**不整体入上下文**，仅以 `resultSummary` + `artifactRef` 参与推理。

## 8. 打包与进程模型

- 开发期：主进程 spawn `uvicorn`（dev）；渲染进程连 `127.0.0.1:<port>`。
- 发布期：CI 用 PyInstaller 把 `services/agent` 打成 `fireeyeaud-agent(.exe)`，
  置入 Electron `extraResources`；主进程启动时 spawn，**随机空闲端口 + 健康检查 +
  退出回收**，端口经 preload 注入渲染进程。
- 用户侧：双击安装包打开即用，无手动部署。模型配置在活动栏 **Models** 面板填写。

## 9. 数据源（分阶段支持）

最终支持三类：Excel/CSV 报表、PDF/扫描件（OCR）、数据库直连（只读）。
MVP 仅先支持 Excel/CSV。

数据库直连通过活动栏的**数据库连接**面板配置：填写连接信息（凭据安全存储）→ 测试连接 →
读取表结构（缓存至 `.fireeye/index/schema.json`）→ 勾选**授权 Agent 可访问的表与字段**。授权清单落盘于 `.fireeye/`，
对话时用户可选用哪个数据源，Agent 仅能访问被授权的表 / 字段。

## 10. MCP 工具策略

两者结合：
- 自建审计工具 Server：`describe_source`（读取 schema 缓存）、`parse_ledger`、`sql_query`、
  `aggregate_subject`、`check_tie`、`sample_vouchers`、`detect_related_party` 等。
- 通用 MCP Server：filesystem、sqlite/数据库查询。
- 联网搜索：web search 工具，**默认关闭**，设置页开启，可配 provider/key。
- MCP 管理：通过活动栏 **MCP** 面板增删 / 启停 Server、查看连接状态与工具列表、配置权限与沙箱范围。

### 10.1 自建工具 I/O 契约

所有工具入参 / 出参为 JSON；结果过大时写 `artifacts/` 并返回 `artifactRef`：

| 工具 | 入参 | 出参 |
|---|---|---|
| `describe_source` | `{ sourceId?, table? }` | `{ tables:[{ sourceId, table, rowCount, columns:[{name,type,sample}] }] }` |
| `parse_ledger` | `{ table, mapping? }` | `{ vouchers:[{ rowRef, voucherNo, date, summary, debit, credit, subject }], warnings:[] }` |
| `sql_query` | `{ sql, limit? }` | `{ columns:[], rows:[], rowCount, truncated, artifactRef? }`（沙箱见 §17.3） |
| `aggregate_subject` | `{ table, subjectCol, debitCol, creditCol }` | `{ subjects:[{ code, name, debit, credit, balance }] }` |
| `check_tie` | `{ table, rules:[] }` | `{ balanced, diffs:[{ subject, expected, actual, delta }] }` |
| `sample_vouchers` | `{ table, method, size, seed? }` | `{ vouchers:[{ rowRef }], method, seed }` |
| `detect_related_party` | `{ table, partyCol }` | `{ parties:[{ name, score, evidence:[{ rowRef, reason }] }] }` |
| `kb_search` | `{ query, kbIds?, topK?, scoreThreshold? }` | `{ chunks:[RetrievedChunk], merged: bool }`（知识库检索，§14.19） |

- 工具在沙箱内执行，受 §17.3 只读 / 限流 / 授权约束；调用与结果写入 Evidence Logger（§14.5）。

## 11. 分阶段实施计划

### Phase 0 — 工作区骨架（打通链路）
- Electron + electron-builder 骨架；`main.cjs` spawn Python sidecar（随机端口/健康检查/退出回收）。
- 渲染进程 Vite+React+TS+Ant Design，VS Code 式布局。
- 活动栏骨架：资源管理器 + 搜索 / 数据库连接 / MCP / Skills / Models 面板占位。
- 深浅主题切换基座（设计令牌 → Ant Design token）+ 窗口状态持久化。
- 「打开文件夹」→ 初始化 `.fireeye/`；工作区占用锁（`.fireeye/.lock`）与关闭语义。
- 引入 i18n 基座（i18next + 命名空间拆分 + 默认 zh-CN 全量 key），所有界面文案走 key。
- `POST /sessions/{id}/chat` 走 LangGraph `astream_events` → SSE 回显。
- 交付：双击打开、选文件夹、发消息看到流式返回。

### Phase 1 — MVP 最小闭环（Excel 导入 + 对话 + 疑点清单）
- Excel/CSV 导入 → DuckDB（仅原始表 `src_*`）；写 `.fireeye/index/schema.json` 并实现 `describe_source` 工具。
- 自建 MCP 工具：`parse_ledger`、`sql_query`、`aggregate_subject`、`check_tie`。
- LangGraph：`plan → tool_call → reflect` + checkpointer；MCP 工具经 `langchain-mcp-adapters` 挂载。
- 疑点写 `.fireeye/findings.jsonl`，SSE 推 `finding`，前端列表刷新。
- 搜索面板：工作区内关键词搜索（ripgrep），glob 过滤与按文件分组。
- Models 管理面板：多套模型配置的增删改与默认选择；**引入配置作用域机制**（global/project，§14.20），供后续 MCP / Skills / DB / 知识库复用。
- 交付：导入科目余额表 → 自然语言提问 → Agent 调工具分析 → 产出疑点清单。

### Phase 2 — 证据与复核
- Evidence Logger：每步写 `.fireeye/evidence.jsonl`；**哈希链**（`hash = sha256(prevHash + 内容)`），打开工作区时校验链完整性。
- 疑点人工复核（确认/驳回/标记）→ 以事件追加到 `.fireeye/findings.jsonl`；详情可展开证据链。
- 规则库设置页：内置规则启停 / 覆盖 severity + 项目自定义规则 CRUD / 启停（§14.12），`POST /rules/{id}/run` 试跑。
- 证据链完整性校验入口（`POST /workspaces/{id}/verify-evidence`）。
- 交付：任一疑点可回溯完整推理步骤与工具调用记录。

### Phase 3 — 证据图谱可视化
- Cytoscape.js：`疑点 → 数据 → 凭证 → 规则/工具` 关联；与文件树/疑点列表联动。
- 交付：图谱页可交互定位到具体数据行与证据。

### Phase 4 — 底稿导出
- Word/Excel 底稿生成（结论、证据、索引、疑点汇总）；模板放 `.fireeye/templates/`。
- 交付：一键导出可归档的审计工作底稿。

### Phase 5 — 扩展数据源
- PDF/扫描件 OCR；**数据库连接面板**（配置连接 + 读取表结构 + 勾选授权表 / 字段 + 对话中选源）。
- 交付：三类数据源均可导入分析，数据库直连受表 / 字段授权约束。

### Phase 5.5 — 知识库接入
- Provider 管理：Dify / RAGFlow 连接配置、测试连通、浏览并勾选远端知识库（作用域 global/project，§14.19）。
- `kb_search` 检索工具 + Provider 适配器归一化；命中片段写入证据链。
- 交付：对话中 Agent 可检索已接入知识库并引用片段。

### Phase 6 — 联网搜索 + 打包发版
- Web 搜索 MCP 工具（默认关闭，设置页开启，可配 provider/key）。
- **MCP 管理面板**（增删 / 启停 / 状态 / 工具列表 / 权限）与 **Skills 管理面板**（内置 + 自定义技能包）。
- 安全加固：CSP、IPC 白名单、sidecar 仅绑 127.0.0.1、敏感信息不落盘明文。
- electron-builder + PyInstaller 双构建 CI，产出 Windows 安装包。
- 交付：一个安装包双击即用的完整版本。

### Phase 7 — 中英双语（多语言）
- 完成 zh-CN 全量 key（自 Phase 0 起持续），补齐 en-US 全量翻译。
- 语言切换 UI（设置页「外观与语言」）+ 应用级持久化。
- 请求携带 `locale`；Agent 系统提示词注入 language directive，新生成内容随语言。
- 底稿 / 导出模板英文版。
- CI 校验各 locale 的 key 集合完整性；缺失 key 回退 zh-CN。
- 交付：界面与产出（疑点、底稿、导出物）可中英切换，英文为完整可用语言；架构支持后续新增语言。

## 12. 关键约定

- 命名：应用/包名 `fireeyeaud`；sidecar 可执行文件 `fireeyeaud-agent`；项目目录 `.fireeye/`。
- 术语：**工作区（workspace）** = 用户「打开文件夹」的审计项目文件夹；**项目（project）** = 其元数据（`project.json`）；UI 文案统一用「工作区」。
- 安全：`contextIsolation: true`、禁用 `nodeIntegration`、IPC 白名单、sidecar 仅绑 127.0.0.1。
- 凭据：模型 API Key 与数据库连接凭据**不落盘明文**，经 Electron `safeStorage`（OS 钥匙串）加密存储。
- 数据授权：数据库表 / 字段授权清单落盘 `.fireeye/`，Agent 仅能访问被授权范围。
- 会话隔离：LangGraph checkpointer 按项目/会话隔离。
- 模型：在活动栏 **Models** 面板配置 base_url/key/model；本地 Ollama 默认 `127.0.0.1:11434`。
- 语言：默认 `zh-CN`，可切 `en-US`；偏好为**应用级全局**设置；缺失 key 回退 `zh-CN`；新增语言只需加 locale 资源目录。
- 数据模型：疑点 ID 规则 `F-<序号>`（计数器持久化于 `project.json.counters`）；`findings` / `evidence` / `rules` 均为 **append-only 事件流**；evidence 附 **SHA-256 哈希链**。
- 契约：前后端共享类型定义于 `packages/shared`（契约即类型）；HTTP 前缀 `/api/v1`；SSE 事件 `seq` 支持 `Last-Event-ID` 续传。
- 配置作用域：models / mcp / skills / knowledge / db 配置项均带 `scope`（`global` → `~/.fireeye/config/`；`project` → `.fireeye/config/`）；有效配置 = 全局 ⊕ 项目（同 `id` 项目覆盖全局）；机密始终在 `safeStorage`（§14.20）。
- 知识库：**仅检索**；接入 Dify / RAGFlow（Provider 适配器归一化），Agent 经 `kb_search` 工具调用（§14.19）。

## 13. 国际化 / 多语言（i18n）

- 目标：先支持简体中文（`zh-CN`，默认）与英语（`en-US`），架构可扩展更多语言。
- 范围：
  - 界面文案（导航、按钮、提示、错误、空态/加载态）。
  - Agent 生成内容（疑点描述、结论、底稿正文）——**新生成内容随当前语言**；已生成的历史内容保持其生成时的语言。
  - 导出物（底稿 / 报告）语言跟随当前语言。
  - 日期 / 数字 / 金额格式按 locale。

方案要点：
1. 前端：i18next + react-i18next + ICU MessageFormat；Ant Design `ConfigProvider` locale 与 dayjs locale 联动。
2. 文案 key 命名空间：`common` / `enums` / `navigation` / `explorer` / `search` / `database` / `knowledge` / `mcp` / `skills` / `models` / `rules` / `findings` / `agent` / `evidence` / `working-paper` / `settings`；资源位于 `packages/shared/locales/{locale}/*.json`。<br>其中 `enums` 承载 14.6 定义的语言中立枚举（severity / status / origin / step / event / sourceType / nodeType / kbProvider / configScope）；`rules` 承载内置规则文案（14.12）；`knowledge` 承载知识库面板文案。
3. 语言检测与切换：默认读取 Electron `app.getLocale()` 映射，未命中回退 `zh-CN`；设置页「外观与语言」可切换。
4. 持久化：**应用级（全局）**，存 `~/.fireeye/config/settings.json`（见 §14.20），所有工作区共享。
5. 后端 / Agent：请求携带 `locale`；系统提示词注入 language directive，控制新生成内容语言。
6. 文案存储策略：状态 / 风险级别 / 规则 / 枚举等用 `key + params`（语言中立），`findings.jsonl` / `evidence.jsonl` 存 key；Agent 自然语言文本存原文 + 生成语言标记 `lang`。展示时按 key 渲染、按 `lang` 标注。
7. 数据格式：`Intl.NumberFormat` / `Intl.DateTimeFormat` 按 locale；金额保留原币种。
8. 字体：`Noto Sans SC` + 拉丁字体回退，中英混排一致。
9. 回退与校验：缺失 key 回退 `zh-CN`；CI 校验各 locale 的 key 集合一致。

验收：切换中 / 英后 UI 全量切换；新提问生成的疑点与底稿为该语言；历史内容保持原语言并标注；日期 / 金额格式正确。

## 14. 数据模型与接口契约

契约总原则：`.fireeye/` 内的文件是**语言中立的、带版本号的结构化数据**；所有自然语言展示由前端按 i18n key 或按 `lang` 渲染。前后端共享类型定义于 `packages/shared`（**契约即类型**）。

### 14.1 实体总览

| 实体 | 落盘位置 | 生命周期 | 备注 |
|---|---|---|---|
| 工作区 / 项目 | `.fireeye/project.json` | 项目级，随项目 | 含 `schemaVersion` |
| 数据源 | `project.json` + DuckDB | 项目级 | 文件 / DB 连接 |
| 会话 / 消息 | `.fireeye/checkpoints.sqlite` | 项目级 | LangGraph checkpointer + `sessions`/`messages` 投影 |
| 疑点 Finding | `.fireeye/findings.jsonl` | 项目级，append-only 事件流 | 核心 |
| 证据 Evidence | `.fireeye/evidence.jsonl` | 项目级，append-only 事件流 + 哈希链 | 核心 |
| 审计规则 | `.fireeye/rules.jsonl` | 项目级，append-only 事件流 | 自定义规则（内置随应用） |
| 大产物 | `.fireeye/artifacts/` | 项目级 | 工具大结果、图谱/底稿导出 |
| 工作底稿 | `.fireeye/artifacts/working-paper/` | 项目级 | 生成的底稿 + manifest |
| schema 缓存 | `.fireeye/index/schema.json` | 项目级 | 数据表结构摘要 |
| 文件指纹 | `.fireeye/index/files.json` | 项目级 | 源文件 size/mtime/sha256 |
| 授权清单 | `.fireeye/authorization.json` | 项目级 | DB 表 / 字段授权 |
| 全局配置 | `~/.fireeye/config/` | 全局 | models/mcp/skills/knowledge/db（`scope=global`）、settings |
| 项目配置 | `.fireeye/config/` | 项目级 | 同结构（`scope=project`） |
| 知识库连接 | 依 `scope` 存于上述配置 | — | Dify / RAGFlow Provider（§14.19） |
| 知识库启用集 | 依 `scope` 存于上述配置 | — | 已启用的远端知识库 |
| 机密 | OS 钥匙串（`safeStorage`） | 全局 | 模型 key / DB 凭据 / KB key（仅引用落 config） |

### 14.2 `project.json`

```jsonc
{
  "schemaVersion": 1,
  "id": "uuid",
  "name": "2025年报审计",
  "createdAt": "2026-10-09T09:00:00+08:00",
  "updatedAt": "2026-10-09T11:20:00+08:00",
  "defaultModelId": "mdl_xxx",           // 引用模型配置 id（全局 ~/.fireeye/config 或项目 .fireeye/config）
  "counters": {                           // 各类 ID 计数器（持久化，避免重号）
    "finding": 12,                        // F-<序号>
    "rule": 1,                            // R-<序号>
    "session": 3,                         // s_<序号>
    "message": 42,                        // m_<序号>
    "dataSource": 2,                      // ds_<序号>
    "connection": 1,                      // conn_<序号>
    "workingPaper": 1                     // wp_<序号>
  },
  "dataSources": [
    { "id": "ds_1", "type": "excel", "path": "数据文件/序时账.xlsx",
      "tables": ["src_ds1_序时账"], "importedAt": "..." },
    { "id": "ds_2", "type": "db", "connectionId": "conn_1",
      "tables": ["vouchers"], "importedAt": "..." }
  ]
}
```

- **DB 凭据不在此文件**（见 14.9）；这里只存 `connectionId` 与数据源清单。
- **事件 `seq` 不在此持久化**：打开工作区时从 `findings.jsonl` / `evidence.jsonl` 末尾推导，追加时 `seq = max+1`（见 14.4 / 14.5）。

### 14.3 数据落库（仅原始表）

- 每个 sheet / 表 → 原始表 `src_<sourceId>_<name>`，**不做规范化、不做列映射**。
- 每张原始表追加隐藏列 **`__row_id`**（导入时生成的稳定行号，写入后不变），供 `dataRefs.rowRef` 定位；重导同一文件时尽量复用。
- 表结构推断结果写入 `.fireeye/index/schema.json`：

```jsonc
{ "sourceId": "ds_1", "table": "src_ds1_序时账",
  "rowCount": 3241, "headerRow": 1,
  "columns": [ { "name": "凭证号", "type": "string", "sample": "记-1182" },
               { "name": "借方金额", "type": "decimal", "sample": "3200000.00" } ] }
```

- MCP 工具新增 **`describe_source`**：返回上述 schema，供 Agent 在查询前先了解列结构（因无规范化层，Agent 必须据此构造 SQL）。

### 14.4 Finding 数据模型（`findings.jsonl`，事件流）

每行一个事件，当前状态由回放折叠得出；`event ∈ { created | status_changed | note_added | severity_changed }`（语义上等价于确认 / 驳回 / 标记 / 误报的事件均归入 `status_changed`，不再单列 `dismissed`）。

`created` 事件：

```jsonc
{
  "event": "created", "seq": 11, "id": "F-0011", "ts": "...",
  "origin": "agent",                       // rule | agent | manual
  "ruleKey": null,                         // 规则引用 id：内置 slug（如 "tie_check"）或自定义 "R-001"；非规则型为 null
  "params": {},                            // 规则参数（origin=rule 时记录阈值等）
  "title":       { "lang": "zh-CN", "text": "关联方交易未披露且无对价说明" },  // origin=rule 时为 null
  "description": { "lang": "zh-CN", "text": "..." },                        // origin=rule 时为 null
  "severity": "high",                      // high | medium | low
  "status": "pending",                     // pending|in_review|confirmed|rejected|false_positive
  "subjects": ["1122"], "amount": "12480000.00", "currency": "CNY",
  "confidence": 0.82,                      // 0–1，Agent 自评置信度（非规则型）
  "dataRefs":     [ { "sourceId": "ds_1", "table": "src_ds1_序时账", "rowRef": "1182" } ],
  "evidenceRefs": [ "ev_42", "ev_43" ],
  "sessionId": "s_1"
}
```

后续事件（**所有事件均带 `seq`** 事件序号、**`id`** 疑点编号）：

```jsonc
{ "event": "status_changed",  "seq": 12, "id": "F-0011",
  "status": "confirmed",       // pending|in_review|confirmed|rejected|false_positive
  "reviewer": "张审计", "comment": "已核实，需在附注补充", "ts": "..." }

{ "event": "note_added",      "seq": 13, "id": "F-0011",
  "note": { "lang": "zh-CN", "text": "已向客户取得补充说明" },
  "author": "张审计", "ts": "..." }

{ "event": "severity_changed", "seq": 14, "id": "F-0011",
  "severity": "medium", "reason": "金额占比偏低", "author": "张审计", "ts": "..." }
```

- **ID**：`F-<序号>`（补零 4 位，超 9999 后扩展位数）计数器持久化于 `project.json.counters.finding`。
- **`seq`**：`findings.jsonl` 内**独立、从 1 开始、单调递增**的事件序号（每次追加 +1），打开工作区时推导。
- **文本策略**：`origin=rule` → `title`/`description` 置 `null`，展示时用 `ruleKey + params` 渲染（语言中立）；`origin=agent`/`manual` → `{ lang, text }`（保留原文与生成语言）。
- **`rowRef` 稳定性**：导入时写入稳定的行号列（`__row_id`），`rowRef` 指向该列而非物理行号，重导后仍可定位（见 14.3）。

### 14.5 Evidence 数据模型（`evidence.jsonl`，事件流 + 哈希链）

```jsonc
{
  "seq": 42, "id": "ev_42", "sessionId": "s_1", "ts": "...",
  "step": "tool_call",                     // thinking | tool_call | tool_result | llm_output
  "findingRefs": ["F-0011"],
  "tool": "sql_query",
  "params": { "sql": "SELECT ... WHERE counterparty LIKE '%鑫源商贸%'" },
  "resultSummary": "命中 4 行，合计 ¥12,480,000",
  "artifactRef": "artifacts/ev_42.json",   // 大结果落盘，日志只存引用
  "durationMs": 38, "tokens": null, "lang": "zh-CN",
  "prevHash": "sha256:...", "hash": "sha256:..."
}
```

- **证据 ID**：`id = ev_<seq>`（`evidence.jsonl` 内的 `seq`，独立于 findings 的 `seq`）。
- **`seq`**：`evidence.jsonl` 内**独立、从 1 开始、单调递增**的事件序号，打开工作区时推导。
- **规范化（canonical form）**：取事件对象**去掉 `hash` 字段**后，对 key 递归按字典序排序、UTF-8 编码、紧凑 JSON（无多余空白）序列化（与 `JSON.stringify` 的 key 顺序无关，实现需稳定）。
- **哈希链**：`hash = "sha256:" + hex(sha256(utf8(prevHash + canonical)))`；首行 `prevHash = ""`。
- 追加时严格按 `seq` 顺序写入（单一写入队列，见 §18）；工作区打开时**校验链完整性**，断链即在 UI 告警并记录；校验算法版本随 `schemaVersion` 演进。
- **关联疑点**：证据在产生时可能尚无 `findingRefs`，故 evidence 落盘时不强制引用疑点；疑点 `created` 事件通过 `evidenceRefs` 反向关联（证据至多被追加一次，不做回写）。

### 14.6 枚举与 i18n key

以下枚举一律语言中立，展示经 `enums.*` 渲染：
- `severity` → `enums.severity.{high,medium,low}`
- `status` → `enums.status.{pending,in_review,confirmed,rejected,false_positive}`
- `origin` → `enums.origin.{rule,agent,manual}`
- `sourceType` → `enums.sourceType.{excel,csv,pdf,db}`
- `step` → `enums.step.{thinking,tool_call,tool_result,llm_output}`
- `event`（findings） → `enums.event.{created,status_changed,note_added,severity_changed}`
- `nodeType` → `enums.nodeType.{finding,dataset,voucher,subject,party,rule,tool}`
- `edgeType` → `enums.edgeType.{derived_from,references,involves,verified_by}`
- `kbProvider` → `enums.kbProvider.{dify,ragflow}`
- `configScope` → `enums.configScope.{global,project}`

### 14.7 SSE 事件契约

信封：`{ "type": string, "seq": number, "sessionId": string, "ts": string, "data": object }`

| type | data | 说明 |
|---|---|---|
| `status` | `{ phase }` | 阶段：planning / executing / reflecting |
| `thinking` | `{ text }` | 推理摘要 |
| `tool_call` | `{ callId, tool, params }` | 工具调用 |
| `tool_result` | `{ callId, summary, ok }` | 结果摘要 |
| `token` | `{ delta }` | 流式 token |
| `finding` | `{ id, event }` | 产出 / 更新疑点（`event` = created / status_changed …） |
| `error` | `{ code, messageKey, params, traceId }` | 错误（i18n key，非硬编码文案；目录见 §16.1） |
| `import_progress` | `{ sourceId, phase, done, total }` | 导入进度（parse / load / index） |
| `done` | `{ usage }` | 结束 |
| `heartbeat` | `{}` | 保活 |

- `seq` 为**该会话 SSE 流**内单调递增的序号（独立于 `findings.jsonl` / `evidence.jsonl` 的 `seq`）→ 支持 `Last-Event-ID` 断线续传；`POST /sessions/{id}/cancel` 可中断。

### 14.8 REST API 契约（前缀 `/api/v1`）

```
GET    /health                                     # { status, appVersion, schemaVersion }
GET    /workspaces/recent                          # 最近工作区（全局，供欢迎页）
POST   /workspaces/open            { path }        # 初始化 .fireeye
GET    /workspaces/current
POST   /workspaces/close                           # 释放 DuckDB / 会话资源
POST   /workspaces/{id}/verify-evidence            # 校验哈希链，返回首个断点
POST   /datasources/import   (SSE 进度)            # 见 §7，返回 { jobId }
POST   /datasources/import/{jobId}/cancel          # 取消导入
GET    /datasources
POST   /datasources/{id}/reimport
DELETE /datasources/{id}
GET    /db/connections ?scope ; POST ; POST /{id}/test ; PATCH /{id}/authorization ; DELETE /{id}
GET    /kb/providers ?scope ; POST ; PATCH /{id} ; DELETE /{id} ; POST /{id}/test
GET    /kb/providers/{id}/knowledge             # 列远端知识库（Dify datasets / RAGFlow datasets）
GET    /kb/enabled ?scope ; PATCH /kb/enabled    # 启用集（按作用域）
GET    /mcp/servers ?scope ; POST ; PATCH /{id} ; DELETE /{id}
GET    /skills ?scope ; POST ; PATCH /{id} ; DELETE /{id}
GET    /rules ; POST ; PATCH /{id} ; POST /{id}/run ; DELETE /{id}
GET    /models ?scope ; POST ; PATCH /{id} ; POST /{id}/test ; DELETE /{id}
GET    /sessions ; POST /sessions ; PATCH /{id} ; DELETE /{id}
GET    /sessions/{id}/messages ?limit&cursor
POST   /sessions/{id}/chat   (SSE) ; POST /sessions/{id}/cancel
GET    /findings ?severity&status&limit&cursor ; GET /findings/{id}
POST   /findings/{id}/review                       # 追加 status/note/severity 事件
GET    /evidence ?findingId&limit&cursor
GET    /graph ?findingId
GET    /artifacts/{path}                           # 读取 artifacts/ 下产物（大结果 / 底稿 / 图谱缓存）
POST   /export/working-paper       { findingIds, format, locale, templateId? }
GET    /settings ; PATCH /settings { locale, theme, webSearch }
```

- **分页**：列表接口接受 `limit`（默认 50，上限 200）与 `cursor`，返回 `{ items, nextCursor }`。
- **错误响应**：非 2xx 统一信封 `{ "error": { "code", "messageKey", "params", "traceId" } }`；错误码目录见 §16。
- **删除**：一律软删除或幂等（重复删除返回 204），不物理清除 append-only 文件。
- **`GET /evidence?findingId`**：因 evidence 落盘时可能不含 `findingRefs`，该过滤经 `findings/{id}.evidenceRefs` 反查 evidence id 集合实现（见 §14.5）。
- **`GET /artifacts/{path}`**：`path` 限定在 `.fireeye/artifacts/` 下（拒绝目录穿越），受 token 保护。
- **配置作用域**：models / mcp / skills / knowledge / db 的列表接口接受 `?scope=global|project`（缺省返回有效并集，带 `scope` 标注）；创建体含 `scope` 字段（§14.20）。
- **文件搜索不走 HTTP**：由 Electron 主进程 spawn 捆绑的 `ripgrep`，经 IPC 返回结果（见 §6 / §3）。
- **安全**：sidecar 每次启动生成随机 token，经 preload 注入渲染进程；所有请求带 `Authorization`；仅绑 `127.0.0.1`。

### 14.9 授权与凭据落盘

- **全局加密**（Electron `safeStorage` / OS 钥匙串）：模型 API Key、DB 连接凭据。
- **项目级明文**（`.fireeye/authorization.json`）：DB 表 / 字段授权清单：

```jsonc
{ "connectionId": "conn_1",
  "tables": { "vouchers": ["voucher_no","date","summary","amount"],
              "counterparties": ["*"] } }
```

Agent 仅能访问被授权的表 / 字段。

### 14.10 版本与迁移

- 版本号统一存于 `project.json.schemaVersion`（代表整个 `.fireeye/` 数据格式）；打开工作区时若版本较低 → 执行迁移脚本 → 备份旧目录后替换。
- HTTP 契约用 `/api/v1`；类型定义集中于 `packages/shared`，前后端共用。

### 14.11 证据图谱数据模型（派生）

图谱**不单独落盘**，由 `findings` + `evidence` + `schema.json` 在展示时派生（可按需缓存到 `artifacts/`）。

- 节点 `nodeType`：`finding` | `dataset`（表 / 文件） | `voucher`（凭证行） | `subject`（科目） | `party`（关联方） | `rule` | `tool`
- 边 `edgeType`：`derived_from`（finding → data）| `references`（finding → evidence / voucher）| `involves`（voucher → subject / party）| `verified_by`（finding → rule / tool）
- 节点 id：`<nodeType>:<refId>`，如 `finding:F-0011`、`voucher:src_ds1_序时账#1182`

### 14.12 审计规则库模型（内置 + 项目自定义）

规则分两级，统一用 `id` 被疑点引用（`findings.jsonl.ruleKey`）：

- **内置规则库（builtin）**：随应用打包、只读。`id` 为稳定 slug（如 `tie_check`、`related_party_undisclosed`）；`name`/`description` 走 i18n key（`rules.builtin.<slug>`），语言中立。不可删除，可**停用**或覆盖 `severity`。
- **项目自定义规则（custom）**：落盘 `.fireeye/rules.jsonl`，**append-only 事件流**，当前状态由回放折叠。`id` 规则 `R-<序号>`（计数器持久化于 `project.json.counters.rule`）。

`created` 事件：

```jsonc
{
  "event": "created", "seq": 3, "id": "R-001",
  "scope": "custom",
  "type": "sql",                            // sql | prompt
  "name": { "lang": "zh-CN", "text": "单笔大额关联方交易" },
  "definition": "SELECT * FROM src_ds1_序时账 WHERE 摘要 LIKE '%鑫源%'",
  "severity": "high",
  "params": { "threshold": 1000000 },
  "enabled": true,
  "ts": "..."
}
```

- 后续事件：`updated`（改定义/severity/params）、`enabled_changed`（启停）、`deleted`（软删除），均带 `seq` 与 `id`。
- **规则类型**：`sql` → 对 DuckDB 原始表执行，命中行产出疑点（`origin=rule`，`ruleKey`=规则 id，`params` 记录阈值等）；`prompt` → 自然语言检测指令，注入 Agent 系统提示词，由 Agent 判定并产出疑点。
- **`ruleKey` 语义**：统一为**规则引用 id**——内置 `slug`（如 `tie_check`）或自定义 `R-001`。展示时：内置 → i18n key `rules.builtin.<slug>`（语言中立）；自定义 → 回放 `rules.jsonl` 取 `name { lang, text }`（保留原文与生成语言）。
- **管理入口**：设置页「规则库」——内置规则列表（启停 / 覆盖 severity）与项目自定义规则增删改启停。

### 14.13 会话与消息

- 会话 id `s_<序号>`（计数器 `counters.session`）。
- **权威状态**：LangGraph `checkpoints.sqlite` 中的 checkpoint；**查询投影**：同库的 `sessions` / `messages` 表（便于列表与分页，可由 checkpoint 重建）。
- `sessions`：`{ id, title({lang,text})|null, createdAt, updatedAt, lastMessageAt, archived }`
- `messages`：`{ id: "m_<序号>", sessionId, seq, role: user|assistant|tool|system, content({lang,text})|{...结构化}, stepRefs:[ev_*], ts }`
- `messages.seq` 为**会话内**消息序号（从 1 递增），与 `findings` / `evidence` 的 `seq` 无关。
- 断线续跑以 checkpoint 为准；`GET /sessions/{id}/messages` 读投影表并按下标分页。

### 14.14 文件指纹（`index/files.json`）

用于检测源文件是否被改动，决定是否提示重导：

```jsonc
{ "path": "数据文件/序时账.xlsx", "size": 204800, "mtime": "...",
  "sha256": "...", "sourceId": "ds_1", "importedAt": "...",
  "status": "ok" }        // ok | stale | missing
```

打开工作区与导入前比对 `size+mtime+sha256`；不一致 → 标记 `stale` 并在 UI 提示「源文件已变更，建议重导」。

### 14.15 工作底稿模型

- **模板**：`.fireeye/templates/*`（内置默认模板随应用，项目可覆盖/新增）；同名覆盖。
- **导出请求**：`{ findingIds, format: word|xlsx|pdf, locale, templateId? }`。
- **产物**：写入 `.fireeye/artifacts/working-paper/<ts>/`，含生成的文档 + `manifest.json`：

```jsonc
{ "id": "wp_001", "createdAt": "...", "format": "word", "locale": "zh-CN",
  "templateId": "default", "findingIds": ["F-0011"], "files": ["底稿.docx"] }
```

- **结构**：封面 / 审计结论 / 疑点汇总 / 证据索引 / 附录。

### 14.16 配置模型（作用域感知）

配置项均带 `scope: "global" | "project"`；global 存 `~/.fireeye/config/`，project 存 `.fireeye/config/`（详见 §14.20）。

- `models.json`：`[{ id:"mdl_<n>", scope, name, provider, baseUrl, model, apiKeyRef, params:{temperature,maxTokens,...}, isDefault }]`；`apiKeyRef` 指向 `safeStorage`（OS 钥匙串）中的密文条目。
- `mcp.json`：`[{ id:"mcp_<n>", scope, name, transport:"stdio"|"sse"|"http", command?, args?, env?, url?, enabled, permissions:{ fsScope, net, toolsAllow:[] } }]`
- `skills.json`：`[{ id:"sk_<n>", scope, nameKey, enabled, promptRef, toolIds:[], params }]`；内置技能 `nameKey` 走 i18n。
- `knowledge.json`：见 §14.19。
- `db.json`：`[{ id:"conn_<n>", scope, name, driver, host?, port?, database?, username?, credRef, authorization? }]`（明文凭据不落此文件，见 §14.9）。
- `settings.json`（仅 global）：`{ locale, theme, webSearch:{ enabled, provider, keyRef }, telemetry:false }`（`telemetry` 恒为 false，且不可开启）。
- `recent-workspaces.json`（仅 global）：`[{ path, name, lastOpenedAt }]`（最多 N 条，供欢迎页「最近工作区」，打开时校验路径存在性）。

### 14.17 数据格式通用约定

- **金额**：字符串十进制（避免浮点误差），保留原币种；比较/求和用 decimal。
- **日期时间**：ISO 8601 带时区偏移（如 `2026-10-09T09:00:00+08:00`）。
- **ID**：计数型 `F-`/`R-`/`s_`/`m_`/`ds_`/`conn_`/`wp_`（序号持久化于 `project.json.counters.*`）；`ev_<seq>` 直接取 evidence 事件序号；应用级对象用 uuid（`mdl_`/`mcp_`/`sk_`）。计数型序号补零 4 位，超 9999 后扩展位数。
- **文本对象**统一 `{ lang, text }`；枚举一律语言中立 key（见 14.6）。
- **文件**：JSONL 一行一事件，UTF-8 无 BOM，行尾 `\n`。

### 14.18 关键请求 / 响应体

| 接口 | 请求体 | 响应体 |
|---|---|---|
| `POST /sessions` | `{ title?, dataSourceIds? }` | `{ id, title, createdAt }` |
| `POST /sessions/{id}/chat` | `{ message, locale?, dataSourceIds?, attachments? }` | SSE（§14.7） |
| `POST /findings/{id}/review` | `{ action: "status"\|"note"\|"severity", status?, note?, severity?, comment? }` | `{ id, status }` |
| `POST /models` | `{ name, provider, baseUrl, model, apiKeyRef?, params?, isDefault? }` | `{ id, name, isDefault }` |
| `POST /db/connections` | `{ name, driver, host?, port?, database?, username?, credRef? }` | `{ connectionId }` |
| `GET /health` | — | `{ status: "ok", appVersion, schemaVersion }` |

- **机密录入流程**：模型 API Key / DB 凭据由渲染进程先经主进程 IPC 存入 `safeStorage` 得到 `apiKeyRef` / `credRef`，再调用上表接口只传引用（明文不下发到 sidecar 持久层，见 §17.2）。
- **`dataSourceIds`**：字段为**已授权给 Agent** 的数据源集合，缺省时取项目全部授权源。

### 14.19 知识库接入模型（仅检索）

- **范围**：仅检索；不在应用内创建 / 上传 / 切分知识库。
- **Provider（连接）**：

```jsonc
{ "id": "kb_<n>", "scope": "project", "type": "dify", "name": "事务所法规库",
  "baseUrl": "https://api.dify.ai/v1", "apiKeyRef": "sec_xxx", "enabled": true,
  "defaults": { "topK": 5, "scoreThreshold": 0.3, "searchMethod": "hybrid_search" } }
```

- **启用集（knowledge）**：

```jsonc
{ "providerId": "kb_1", "knowledgeId": "<远端 id>", "name": "审计准则",
  "scope": "project", "enabled": true }
```

- **统一检索结果**（适配器归一化）：

```jsonc
RetrievedChunk = { provider, providerId, knowledgeId, knowledgeName,
  docId, docName, content, score, url?, metadata? }
```

| Provider | 列表 | 检索 | 鉴权 |
|---|---|---|---|
| Dify | `GET {baseUrl}/datasets` | `POST {baseUrl}/datasets/{id}/retrieve` `{ query, retrieval_model:{ search_method, top_k, score_threshold_enabled:true, score_threshold } }` | `Bearer <key>` |
| RAGFlow | `GET {baseUrl}/api/v1/datasets` | `POST {baseUrl}/api/v1/retrieval` `{ question, dataset_ids, top_k, similarity_threshold, keyword:true }` | `Bearer <key>` |

- **参数映射**：`query` → Dify `query` / RAGFlow `question`；`topK` → Dify `retrieval_model.top_k` / RAGFlow `top_k`；`scoreThreshold` → Dify `score_threshold`（+`score_threshold_enabled:true`）/ RAGFlow `similarity_threshold`。Dify `query` 上限 250 字符，超长截断。
- **工具**：`kb_search`（§10.1）；无 `kbIds` 时用**有效启用集**，多库 fan-out 后按 `score` 合并。
- **证据**：每次检索写 evidence（`step=tool_call`、`tool=kb_search`；大结果 → `artifactRef`）；命中依据可被疑点 `evidenceRefs` 引用。

### 14.20 配置作用域（global / project）

- **位置**：global → `~/.fireeye/config/`；project → `.fireeye/config/`。
- **字段**：models / mcp / skills / knowledge / db 每项带 `scope`；`settings.json` / `recent-workspaces.json` 仅 global。
- **合并**：打开工作区时 `effective(id) = project 覆盖 global`（同 `id`），不同 `id` 追加；列表接口缺省返回并集并带 `scope` 标注。
- **机密**：模型 key / DB 凭据 / KB key 一律存 `safeStorage`（OS 钥匙串），两种作用域 config 只存引用，故 `.fireeye/` 可安全纳入版本控制（§17.2）。
- **UI**：面板项显示「全局 / 本项目」徽标；新建时可切换作用域。

## 15. 风险

- PyInstaller 打包 Python sidecar 体积偏大、首次冷启动较慢 → 需在 Phase 0 验证可行性。
- 多进程本地架构需处理端口冲突与 sidecar 僵尸进程回收。
- 数据分析正确性依赖表结构与凭证解析质量，需重点测试勾关系等核心算法。
- 哈希链在并发写入下若未严格串行会断裂 → 由 §18 单一写入队列规避。
- DuckDB / SQLite 文件损坏或加锁失败会影响可用性 → 见 §16.4 恢复策略。
- 表格内容驱动的提示词注入可能诱导工具误用 → 见 §17.4 防护。

## 16. 错误处理与容错

### 16.1 错误码目录

统一错误信封 `{ "error": { "code", "messageKey", "params", "traceId" } }`，`messageKey` 走 i18n（§13）：

| code | HTTP | 含义 |
|---|---|---|
| `E_WS_LOCKED` | 409 | 工作区已被其它实例占用 |
| `E_WS_SCHEMA_TOO_NEW` | 409 | `schemaVersion` 高于当前应用，需升级 |
| `E_IMPORT_PARSE` | 422 | 文件解析失败（格式/编码/表头） |
| `E_IMPORT_DUP` | 409 | 重复导入（文件指纹相同） |
| `E_DB_CONN` | 502 | 数据库连接失败 |
| `E_DB_UNAUTHORIZED` | 403 | 访问未授权的表 / 字段 |
| `E_SQL_REJECTED` | 400 | SQL 被沙箱拒绝（见 §17.3） |
| `E_SQL_TIMEOUT` | 504 | 查询超时 |
| `E_LLM_UNAVAILABLE` | 503 | 模型不可达 |
| `E_LLM_AUTH` | 401 | 模型鉴权失败 |
| `E_MCP_START` | 502 | MCP Server 启动失败 |
| `E_EVIDENCE_CHAIN` | 409 | 证据链断裂 |
| `E_AGENT_LIMIT` | —（SSE `done` 内提示） | 达到 `maxSteps` / 单轮超时上限 |
| `E_ARTIFACT_NOT_FOUND` | 404 | 产物不存在或已清理 |
| `E_IMPORT_CANCELLED` | 409 | 导入被用户取消 |
| `E_INTERNAL` | 500 | 内部错误 |

### 16.2 sidecar 生命周期

- **启动**：主进程选随机空闲端口 → spawn → 轮询 `GET /health`（超时退避重试，上限 N 次）；失败则 UI 提示并提供「重试 / 诊断」。
- **运行**：周期心跳；连续失败 → 自动重启（上限 N 次），仍失败 → 全局告警降级（禁用 Agent 功能但保留已落盘数据浏览）。
- **退出**：主进程退出 / 窗口关闭 / 崩溃时回收子进程（先 graceful，超时强杀），避免僵尸。
- **日志**：结构性日志落 `~/.fireeye/logs/agent-<date>.log`（轮转），设置页可导出诊断包（脱敏）。

### 16.3 失败与重试

- 导入 / 导出：失败即回滚（事务），不修改原文件；可重试。
- LLM 调用：超时 / 限流按指数退避重试，可由用户中断。
- 长任务取消：`sessions/{id}/cancel`、`import` 取消 → 清理中间产物，已落盘事件不回滚（append-only）。

### 16.4 数据损坏恢复

- **DuckDB 损坏**：`workspace.duckdb` 可由源文件重导重建（UI「重建数据库」）；不影响 `findings` / `evidence`。
- **哈希链断裂**：不阻断使用，UI 标红受影响证据并用 `verify-evidence` 定位断点。
- **project.json 损坏**：写入前留 `.bak`；损坏时提示用备份恢复。
- **JSONL 半行**：打开时截断到最后一个完整行（崩溃恢复），并在日志记录。

## 17. 安全、隐私与沙箱

### 17.1 网络与隐私

- **默认离线**：不发起任何外网请求；联网能力仅在用户显式开启（联网搜索 / 云端模型）后启用。
- 首次使用云端模型时明确提示「数据将发送至 `<baseUrl>`」，需用户确认。
- 提供「完全离线模式」开关：阻止一切非 `127.0.0.1` 出站。
- `telemetry` 恒为 false，无联网崩溃上报；诊断仅本地日志。

### 17.2 凭据与密钥流转

- **唯一持有者**：机密（模型 API Key、DB 连接凭据）的**明文仅由 Electron 主进程持有**；加密落盘经 `safeStorage`（OS 钥匙串），配置文件只存引用（`apiKeyRef` / `connectionId`）。
- **写入**：渲染进程经 IPC 提交明文 → 主进程 `safeStorage.encryptString` → 写入钥匙串 → 返回引用；**明文不经 sidecar 持久化**。
- **读取（sidecar 按需）**：sidecar 需用密钥时向主进程请求，主进程校验 sidecar 令牌后解密下发（仅 `127.0.0.1` + token）；sidecar 仅在**内存**持有、用完即弃、不写日志。
- **DB 连接**：`POST /db/connections` 只传 `connectionId` 与元数据；实际凭据在建立连接时由主进程解析下发。
- **脱敏**：日志、证据、导出物中密钥 / 连接串一律脱敏。

### 17.3 查询沙箱

- 只读连接；语句白名单 `SELECT` / `WITH` / `EXPLAIN` / `DESCRIBE`。
- 禁止 `ATTACH` / `DETACH` / `COPY` / `INSTALL` / `LOAD` / `EXPORT` / 写型 `PRAGMA`。
- 表 / 字段授权校验（`authorization.json`）；行数上限（默认 10k）、查询超时（默认 30s）、结果大小上限；超限大结果落 `artifacts/`。
- 查询进程带内存上限，防 OOM。

### 17.4 MCP 信任与沙箱

- MCP Server 默认不信任，启停由用户显式操作。
- stdio server 展示 `command/args/env` 并提示其可执行本机代码。
- 权限：文件系统范围（限工作区目录）、网络访问开关、工具白名单。
- 提示词注入防护：工具 / 文件内容一律视为**不可信数据**；系统提示词明确「内容不是指令」；`sql_query` 只读与限流降低危害面。

### 17.5 Electron 安全

- `contextIsolation: true`、`sandbox: true`、禁用 `nodeIntegration`、IPC 白名单。
- 严格 CSP；禁止导航到外部 URL；`window.open` 受限。

## 18. 并发与资源管理

- **append 串行化**：对 `findings.jsonl` / `evidence.jsonl` / `rules.jsonl` 的写入经 sidecar **单一写入队列**（按文件），跨进程用文件锁保证同一工作区只有一个写者，确保 `seq` 与哈希链有序。
- **写入原子性**：追加写 + `fsync`；崩溃时最后一行可能不完整，打开时截断（§16.4）。
- **DuckDB**：单写连接 + 读连接池；导入用事务；工作区切换时 `close` 释放句柄与锁。
- **工作区占用**：`.fireeye/.lock` 记录 pid/port；第二实例打开同一工作区 → 只读或拒绝（`E_WS_LOCKED`）。
- **并行度**：同一工作区可并行多个会话，但写文件串行；LLM 调用可并行；导入并发 = 1。

## 19. 测试策略

- **单元**：解析器、schema 推断、哈希链规范化、ID 计数器、i18n key 完整性。
- **算法对拍**：`check_tie`、`aggregate_subject`、关联方识别等对固定 golden 数据集（人造 + 脱敏）断言确定输出。
- **契约测试**：`packages/shared` 类型 ↔ API 响应 / JSONL schema 双向校验（TS zod / Pydantic）。
- **集成**：sidecar 起停、导入 → 查询 → 产出疑点 → 复核 → 证据链校验。
- **E2E**：Playwright(Electron) 覆盖打开工作区、导入、对话、复核、导出。
- **CI**：PR 跑单元 + 契约 + 关键集成；发版前跑 E2E。

## 20. 性能与可观测性

- **目标（基线，Phase 0 校准）**：冷启动 ≤ 3s（不含首次模型加载）；打开工作区 ≤ 1s；导入 10 万行 ≤ 10s；普通 SQL ≤ 2s。
- **规模上限**：单文件 ≤ 200MB / 100 万行（超限分块或拒绝并提示）。
- **可观测**：结构化 JSONL 日志（含 `traceId`）；统计请求耗时、LLM token / 费用；设置页「诊断」导出脱敏日志包。

## 21. 构建与发布

- **平台**：Windows 优先，随后 macOS / Linux。
- **构建**：electron-builder（桌面）+ PyInstaller（sidecar）双构建 CI（GitHub Actions 矩阵）。
- **签名**：Windows Authenticode、macOS 公证；无签名时给安装提示。
- **更新**：electron-updater（可选渠道）；离线环境可禁用更新检查。
- **版本**：语义化版本；`project.json.schemaVersion`（数据格式）与 `appVersion`（应用）分别演进，迁移脚本参照 `minAppVersion`。
- **产物**：NSIS 安装包 / dmg / AppImage；sidecar 作为 `extraResources`。

## 22. Backlog / 未决事项

- 批量 / 多文件审计、跨工作区对比。
- 审计抽样（统计抽样）算法。
- 多人协作 / 审阅流转（当前为单机单用户）。
- 插件市场（Skills / 规则分享）。
- 更多数据源格式适配（金蝶 / 用友**导出文件**）；明确**不**做账套直连。
- 底稿富文本编辑器、图表增强。
- 增量导入与源变更自动重导。
- 多币种换算与合并报表。
