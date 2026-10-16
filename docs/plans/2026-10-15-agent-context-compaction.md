# Phase 9 · Agent 上下文压缩（Context Compaction）

- 日期：2026-10-15
- 状态：**已实现**（2026-10-16 完成）。实现落点：`agent/token_budget.py`、`agent/compaction.py`、
  `agent/graph.py`、`store/sessions.py`、`store/app_settings.py`、`config/models.py`、`config/settings.py`、
  `api/models.py`、`api/settings.py`、`api/sessions.py`；前端 `apps/renderer`（`store/chat.ts`、
  `components/AgentColumn.tsx`、`lib/api.ts`）与 `packages/shared`（types/locales）。
- 关联模块：`agent/graph.py`、`agent/prompts.py`、`store/sessions.py`、`config/models.py`、`config/settings.py`、`store/app_settings.py`、`api/sessions.py`
- 相关文档：[技能按需加载](./2026-10-15-skills-on-demand-loading.md)、[MCP 接入](./2026-10-15-mcp-tool-integration.md)

> 实现要点与偏差见文末「实现说明」。摘要仅供模型短期记忆，**不承担取证职责**（§8）。

---

## 1. 背景与现状（as-is）

### 1.1 历史全量重放

`agent/graph.py` 的 `_load_history(fe, session_id)`（约 L452）从 `.fireeye/checkpoints.sqlite` 读取该会话全部消息并逐条重放：

```python
def _load_history(fe: Path, session_id: str) -> list[BaseMessage]:
    history: list[BaseMessage] = []
    for item in get_messages(fe, session_id):
        ...
        history.append(HumanMessage(content=text))
        ...
        history.append(AIMessage(content=text))
    return history
```

`run_agent` 把 system prompt + **全部历史** + 本轮用户消息拼成一个 `messages` 列表（L266–L285）：

```python
messages = [SystemMessage(content=system_prompt(locale, rules, skill_prompts, custom_prompt))]
...
if history:
    messages.extend(history)
messages.append(HumanMessage(content=step1_text))
```

### 1.2 system prompt 本身也可能很大

`prompts.py::system_prompt` 会把**所有**会话生效规则（含完整 SQL）与**所有**技能提示词完整拼进 system prompt（见 L44–L62）。它不是压缩对象（应始终保持），但会占用预算。

### 1.3 现状的其他事实

| 事实 | 位置 | 影响 |
|---|---|---|
| 无 token 计数 | 全仓库无估算逻辑 | 无法判断是否接近窗口 |
| `done` 事件的 `usage` 恒为 `{}` | `graph.py:449` | 拿不到 provider 用量 |
| 模型档案无 `contextWindow` | `config/models.py`（仅 baseUrl/model/temperature） | 不知道每个模型窗口多大 |
| 历史读取上限 200 条 | `store/sessions.py::get_messages(limit=200)` | 只是条数上限，非 token 上限 |
| 溢出错误被泛化 | `graph.py:352-366` → `E_LLM_UNAVAILABLE` | 撞上下文窗口时报错不可读、无自愈 |

### 1.4 用户可见的失败形态

会话变长后，模型侧返回 context-length 超限，前端只看到 `E_LLM_UNAVAILABLE`（带一段原始 reason），无从判断是窗口问题，也无法继续。

---

## 2. 目标

1. 会话超过模型上下文预算时，**自动**把较早的对话压缩成一段摘要，保留最近一段原始对话，使会话可持续。
2. 压缩**持久化**，后续轮次更新同一摘要，而非每轮重算。
3. **每轮按当前所选模型**重算预算，正确处理会话中途切换模型导致的窗口差异（见 §6）。
4. 压缩过程对用户**可解释**（事件 + 界面提示），且**可手动触发**。
5. provider 溢出作为最后兜底：捕获后强制压缩一次并重试。

## 3. 非目标

- 不做 provider 原生压缩（如 Anthropic 的 server-side compaction）；本项目统一走 OpenAI-compatible 接口。
- 不做跨会话记忆/长期记忆。
- 不改动审计留痕的权威性：`evidence.jsonl` / `findings.jsonl` 仍是事实来源，**摘要不用于引用与取证**（见 §8）。

---

## 4. 设计

### 4.1 token 预算

```
可用预算 = contextWindow(当前模型)
         - reserveOutput(预留给本轮回答，默认 4096)
安全预算 = 可用预算 × safetyFactor(默认 0.8)
触发阈值 = 安全预算 × threshold(默认 0.9)
```

估算对象：

```
tokens = tokens(system_prompt) + tokens(history) + tokens(本轮用户消息 + 附件文本)
```

- `tokens()` 用统一估算器：优先 `tiktoken`（OpenAI-compatible 常见），失败回退启发式（CJK ≈ 1 字/0.7 token，拉丁 ≈ 4 字符/token）。**不同模型分词不同**，故用 `safetyFactor` 留冗余。

### 4.2 摘要与保留策略

```
触发压缩时：
  summarizedUpTo = 从最早开始、直到「剩余历史 token ≤ keepTokens」之前的那条消息 seq
  summary' = LLM(旧 summary 文本 + seq∈(旧 summarizedUpTo, summarizedUpTo] 的消息)  # 增量更新
```

- `keepTokens`（默认 15000，可配）：始终保留的最近原始对话量。
- 摘要放在历史**最前**（system prompt 之后、保留区之前），以一条特殊消息注入，不写回普通 messages 表。
- **绝不压缩**：system prompt、本轮用户消息、`compactedUpTo` 之后的保留区。

### 4.3 持久化

在 `sessions` 表新增列（`store/sessions.py::_connect` 用 `ALTER TABLE` 幂等升级，沿用现有 `context`/`modelId` 的做法）：

| 列 | 类型 | 说明 |
|---|---|---|
| `summary` | TEXT | 当前摘要文本（JSON，含 `{text, upTo, createdAt}`） |
| `compactedUpTo` | INTEGER | 已并入摘要的消息 seq 上界 |
| `summaryModel` | TEXT | 生成摘要时的模型 id（诊断用） |
| `summaryWindow` | INTEGER | 生成摘要时的 contextWindow（诊断用） |
| `tokensEstimate` | INTEGER | 最近一轮估算总 token（诊断/UI 用） |

> 摘要不进 `messages` 表，避免污染会话历史渲染与 `_load_history`。

### 4.4 触发时机

1. **每轮发送前**：估算超阈值 → 压缩后再构建 `messages`。
2. **切换模型后首轮**：按新模型窗口重算，必要时立即压缩（§6.3）。
3. **手动**：`POST /sessions/{id}/compact`。
4. **溢出兜底**：捕获 provider context-length 错误 → 强制压缩一次 → 重试一次。

### 4.5 SSE / API / UI

- 新增 SSE 事件：

```json
{ "type": "compaction", "data": { "phase": "done", "summarizedUpTo": 12,
  "tokensBefore": 48210, "tokensAfter": 15320, "modelId": "mdl_2", "window": 131072 } }
```

- 新路由 `POST /sessions/{id}/compact`（返回压缩后的估算）。
- 顺手让 `done.usage` 携带 `{ tokensEstimated, contextWindow }`（当前恒为 `{}`）。
- 前端（`AgentColumn.tsx` / `store/chat.ts`）：在对话流中渲染一条分隔提示「较早的 N 条对话已压缩为摘要（约 48k → 15k tokens）」；可选提供手动「压缩」按钮。

---

## 5. 数据模型与配置变更

**模型档案**（`models.json` / `api/models.py` `ModelBody`）新增可选字段：

```jsonc
{ "id": "mdl_2", "name": "…", "baseUrl": "…", "model": "…",
  "contextWindow": 131072,      // 新增：上下文窗口（token）
  "maxOutputTokens": 8192       // 新增：可选，用于 reserveOutput 推导
}
```

**环境配置**（`config/settings.py`，前缀 `FIREYEAUD_`）：

```python
default_context_window: int = 8192      # 窗口未知时的保守回退
context_safety_factor: float = 0.8
compact_keep_tokens: int = 15000
compact_reserve_output_tokens: int = 4096
```

**应用设置**（`store/app_settings.py`，仅 global）：

```jsonc
{ "compaction": { "auto": true, "keepTokens": 15000, "reserveOutputTokens": 4096, "threshold": 0.9 } }
```

---

## 6. 重点：模型切换与上下文长度差异

> 这是本方案与「固定窗口」实现最大的不同点。会话可在中途切换模型（会话级 `modelId`，见 `store/sessions.py::update_session_context`），而**不同模型的上下文窗口差异极大**：本地 Ollama qwen2.5 常见 8k/32k，云端模型可达 128k/200k。压缩是**有损**的，必须正确处理窗口变化。

### 6.1 问题

- 摘要一旦生成**不可逆**（原始逐字对话已丢弃，无法"解压"）。
- 在**小窗口**模型下压缩，可能对小窗口已足够、但对后续切到的**大窗口**模型过度压缩（丢失细节）。
- 在**大窗口**下未压缩的历史，切到**小窗口**模型后可能**直接超限**。

### 6.2 设计原则

1. **预算永远按当前模型每轮重算**，不缓存固定预算。
2. 摘要文本与模型无关（纯文本）；**保留多少最近原始历史**（`keepTokens`）与窗口相关，可随模型变化。
3. **向上切换（小→大窗口）不回滚摘要**：继续用现有摘要，仅让后续保留区能容纳更多原始历史；界面明确标注「此前内容已压缩」。
4. **向下切换（大→小窗口）若未压缩历史已超新预算，发送前强制压缩一次**（compaction-on-switch）。
5. **窗口来源优先级**：`models.json.contextWindow` → provider `/models` 元数据（若可解析）→ `FIREYEAUD_DEFAULT_CONTEXT_WINDOW`（默认 8192，保守）。
6. **分词器差异**用统一估算器 + `safetyFactor` 兜底。
7. **溢出兜底**：捕获 provider 的 context-length 错误（按错误码/文本匹配）→ 强制压缩 1 次 → 重试 1 次；仍失败才报 `E_LLM_UNAVAILABLE`（错误信息中带上估算值，便于定位）。
8. `summaryModel` / `summaryWindow` 仅作诊断记录，**不用于回滚**。

### 6.3 切换逻辑（伪代码）

```python
def prepare(root, session, model_id):
    prof   = select_profile(root, model_id)
    window = prof.get("contextWindow") or provider_window(prof) or settings.default_context_window
    keep   = min(app_settings.compaction.keepTokens, int(window * 0.5))
    est    = estimate_tokens(system_prompt(...), history_after_summary(session), new_turn)
    if app_settings.compaction.auto and est > window * safety * threshold:
        summary, upTo = compact(root, session, model_id, window, keep)   # 增量更新
        persist_summary(session, summary, upTo, model_id, window)
    return build_messages(session)
```

### 6.4 边界情形

| 情形 | 行为 |
|---|---|
| 窗口未知 | 用默认 8192 + 保守 `safetyFactor` |
| 单轮附件文本即超预算 | 附件文本已按 `attachment_total_chars` 截断；仍超则对本轮附件再降级并提示 |
| system prompt 超预算 | 不可能的极端情况：报错并提示精简规则/技能（与技能按需加载联动） |
| 摘要在同一 seq 上反复重算 | 以 `compactedUpTo` 幂等判断，未越过边界则跳过 |

---

## 7. 风险

1. **有损**：摘要是 LLM 生成，可能遗漏审计相关事实。缓解：留痕（evidence/findings）独立持久化，摘要不承担取证职责；`keepTokens` 可调大。
2. **不确定性**：摘要依赖模型调用。缓解：摘要**落库**，后续只增量更新，不在每轮重生成。
3. **成本**：压缩本身消耗一次模型调用。缓解：仅在超阈值时触发。
4. **估算误差**：分词器不一致导致误判。缓解：安全系数 + provider 溢出兜底。
5. **窗口元数据缺失**：多数 OpenAI-compatible 端点不返回窗口。缓解：模型档案手填 + 保守默认。

## 8. 与审计留痕的关系（重要）

- `evidence.jsonl`（每次工具调用/参数/结果/耗时）与 `findings.jsonl` 是**权威事实来源**，独立于对话历史。
- 摘要**只服务模型短期记忆**，不进入导出底稿、不用于引用定位。
- 因此压缩可以放心有损，但不得改动 evidence/findings 的写入路径。

## 9. 测试

- [x] `estimate_tokens`：纯 CJK / 纯拉丁 / 混合 / 空串 / 超长附件文本。
- [x] 阈值触发：构造历史刚好超/未超阈值，断言是否调用压缩。
- [x] 增量更新：多次压缩只在 `compactedUpTo` 之后增量并入。
- [x] 幂等：同一 `compactedUpTo` 不重复压缩。
- [x] **模型切换**：小→大不回滚；大→小触发即时压缩。
- [x] 窗口未知：回退默认值。
- [x] 溢出兜底：fake 模型抛 context-length 错误 → 触发压缩并重试一次。
- [x] 持久化：`summary`/`compactedUpTo` 落库并在重开后可恢复。
- [x] 事件：`compaction` SSE 事件 `phase=done` 字段完整。
- [x] 不变量：system prompt 与本轮用户消息从不被压缩。

> 覆盖于 `services/agent/tests/test_token_budget.py`、`test_compaction.py`、
> `test_agent_compaction.py`、`test_sessions.py`、`test_settings_api.py`、`test_models_api.py`。

## 10. 任务拆解

- [x] T1 `config/models.py` + `api/models.py`：档案新增 `contextWindow` / `maxOutputTokens`。
- [x] T2 新增 `agent/token_budget.py`：估算器 + 预算计算。
- [x] T3 `store/sessions.py`：新增列与 `get/set_summary`、`update_summary`。
- [x] T4 新增 `agent/compaction.py`：压缩决策 + LLM 摘要（增量）。
- [x] T5 `agent/graph.py`：`run_agent` 发送前接入 `prepare()`；`_load_history` 注入摘要。
- [x] T6 溢出兜底重试逻辑。
- [x] T7 `api/sessions.py`：`POST /sessions/{id}/compact`；`done.usage` 填充。
- [x] T8 前端：`compaction` 事件渲染 + 可选手动按钮。
- [x] T9 测试 + 文档。

## 12. 实现说明（2026-10-16）

- **估算器**：优先 `tiktoken`（若已安装，作为 langchain 传递依赖常见存在），否则启发式
  CJK≈1 token/字、拉丁≈4 字符/token。测试对边界断言固定用启发式以与后端分词器解耦。
- **摘要注入位置**：压缩在 `run_agent` 内、构建 messages 之前执行（`history_entries` 为本轮之前的
  会话投影）；摘要以一条 `SystemMessage` 注入在 system prompt 之后、保留区之前。`_load_history`
  保留为「条目 → BaseMessages」的辅助函数。
- **强制压缩**：溢出兜底与手动压缩均以 `force=True` 调用 `prepare`；若常规边界未推进，则回退为
  「保留最新一条、其余并入」，保证压缩有进展且**最新一条永不被压缩**。
- **前端**：`renderer` 无测试框架，T8 的验证以 `tsc --noEmit` + `vite build` 为准。

## 11. 待决问题（已定）

1. 摘要用**同一模型**（当前会话所选模型）生成，避免额外配置。
2. `keepTokens` 默认 15000，且再取 `min(keepTokens, window/2)`，小窗口下自动收缩。
3. 暂不暴露「压缩前原文导出」；`evidence.jsonl` / `findings.jsonl` 已是权威留痕（§8）。
