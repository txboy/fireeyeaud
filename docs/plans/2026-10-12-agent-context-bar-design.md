# Phase 8 · 对话上下文栏（模型默认 + 资源多选）

- 日期：2026-10-12
- 状态：已完成

## 目标

把模型选择从对话栏头部移到**输入框上方**，并在同一处增加对 **MCP / 技能 / 数据库 / 知识库**
的多选。每个实体新增独立的 `isDefault`：

- `isDefault` 的实体**自动**提供给模型，不在上下文栏出现（不可选）。
- 非默认的实体，**用户在上下文栏勾选后**模型才能使用。
- 模型为单选：打开会话时默认选中默认模型，会话中可随意切换，默认模型仍出现在列表中。

## 语义

- `enabled` = 可用总开关（沿用现有列表里的「启用」）。
- `isDefault` = 默认自动提供给模型。
- **默认集** = `enabled && isDefault` 的实体 → 自动生效，不出现在可选列表。
- **可选集** = `enabled && !isDefault` 的实体 → 在上下文栏勾选后生效。
- **本次会话上下文** = 默认集 ∪ 勾选集。
- 选择为**会话级**、内存持有；新建 / 切换会话时清空勾选。

## 数据模型

给以下实体新增 `isDefault?: boolean`：

| 实体 | 前端类型 | 后端 Body/Patch | 表单 |
|---|---|---|---|
| `McpServer` | types.ts | `api/mcp.py` `ServerBody`/`ServerPatch` | `McpForm` |
| `Skill` | types.ts | `api/skills.py` `SkillBody`/`SkillPatch` | `SkillForm` |
| `DbConnection` | types.ts | `api/db.py` `ConnectionBody`/`ConnectionPatch` | `DatabaseForm` |
| `KbProvider` | types.ts | `api/knowledge.py` `ProviderBody`/`ProviderPatch` | `KnowledgeForm` |

`ModelProfile.isDefault` 已存在，保留。

## 后端（Agent sidecar）

- `api/sessions.py`：`ChatBody` 新增 `skillIds / kbProviderIds / dbConnectionIds / mcpServerIds`
  （均为 `list[str] | None`）；`stream_chat` 接收 `context`。
- `agent/graph.py`：`run_agent`/`stream_chat` 新增 `context` 参数，计算生效集合并注入：
  - **技能**：系统提示词注入 = 默认技能 ∪ 勾选技能（`enabled` 前提）。替换现有
    「所有 enabled 注入」（`store/skills.enabled_prompts`）。
  - **数据库**：`sql_query` 传入允许的连接 id 集合，`source` 命中连接不在集合内则拒绝。
  - **知识库**：`kb_search` 传入允许的 Provider id 集合。
  - **MCP**：仅接收透传，本阶段不改行为。
- `tools/registry.py`：`build_langchain_tools(root, context)` / `build_tool_dict(root, context)`，
  把生效集合通过闭包 / 参数交给 `sql_query`、`kb_search`。
- `store/skills.py`：新增 `prompts_for(root, skill_ids)`（默认 ∪ 指定，均要求 `enabled`）。
- `tools/kb_search.py`：新增 `allowedProviderIds` 参数（默认 ∪ 勾选）。
- `tools/sql_query.py`：新增 `allowedConnectionIds` 参数（默认 ∪ 勾选）。

## 前端（renderer）

- `store/chat.ts`：新增 `context: { skillIds; kbIds; dbIds; mcpIds }` + `setContext`；
  `send` 时随请求带上；`newSession`/`clear`/`selectSession` 清空。
- `lib/api.ts`：`streamChat` 请求体带上 `context`。
- `components/AgentColumn.tsx`：头部只保留标题；输入框上方新增 `ContextBar`。
- 新增 `components/ContextBar.tsx`：
  - 模型下拉（单选，默认预选 `isDefault`/首个）。
  - 各域「非默认且启用」项的勾选 chips；某域无可选项时不显示该域。
- `components/forms/*`：四个表单加「默认」勾选框。
- i18n：`agent.context` / `agent.contextEmpty` / 各域 `isDefault` 标签。
- CSS：`.agent__context` / `.ctx-chip` 等。

## 测试

- 后端：`tests/` 补 context 过滤用例（技能默认∪勾选、知识库 Provider 过滤、数据库连接过滤）。
- 前端：`renderer:typecheck` / `renderer:build`；`desktop:test`。

## 不做 / 已知限制

- MCP 工具加载仍未接入，选择只透传、暂不改变 agent 行为。
- 会话上下文为内存级：切换会话不保留、重启重置。
- 知识库按 Provider 级：Provider 纳入后，只加入其**已启用**的知识库条目。
