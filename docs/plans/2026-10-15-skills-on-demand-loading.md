# Phase 9 · 技能按需加载（Skills On-Demand Loading）

- 日期：2026-10-15
- 状态：**未实现**（本文为设计方案；仓库中尚无对应代码，当前行为见「现状」）
- 关联模块：`store/skills.py`、`api/skills.py`、`agent/prompts.py`、`agent/graph.py`、`tools/registry.py`、`store/app_settings.py`
- 相关文档：[上下文压缩](./2026-10-15-agent-context-compaction.md)、[MCP 接入](./2026-10-15-mcp-tool-integration.md)

> **本文实现的功能目前不存在。** 目前技能提示词是**全量注入** system prompt 的；本文描述拟改为「先广告元数据、按需 `load_skill` 拉取正文」。

---

## 1. 背景与现状（as-is）

### 1.1 技能 = 一段提示词

`store/skills.py`：

```python
def prompts_for(root, skill_ids):
    """会话生效技能提示词 = 默认（enabled ∧ isDefault）∪ 勾选（enabled ∧ id∈skill_ids）。"""
    ...
```

技能的会话生效规则与数据库/知识库一致：**默认（enabled ∧ isDefault）∪ 勾选**。

### 1.2 全量注入

`agent/graph.py`（L264）：

```python
skill_prompts = prompts_for(root, (context or {}).get("skillIds"))
```

`agent/prompts.py::system_prompt`（L58–L62）把每个生效技能的**完整 `prompt`** 拼进 system prompt：

```python
if skills:
    lines = ["", "可参考的审计技能（方法与视角，非强制流程）："]
    for skill in skills:
        lines.append(f"- {skill.get('name', '')}：{skill.get('prompt', '')}")
    text += "\n".join(lines) + "\n"
```

### 1.3 现状事实

| 事实 | 影响 |
|---|---|
| 生效技能的**全文**每轮都在 system prompt 里 | 技能越多，system prompt 越大，**每轮**都付费 |
| 无 `load_skill` 工具 | 模型无法按需获取正文 |
| 技能只有 `name` + `prompt` | 缺少「一句话描述 / 何时使用」用于广告 |
| 与上下文压缩相互放大 | system prompt 变大 → 挤压历史预算（见压缩文档 §6.4） |

---

## 2. 目标

1. system prompt 里只放技能**元数据**（名称 + 简短描述 + 何时用），成本与技能正文长度解耦。
2. 新增 `load_skill(skillId)` 工具，模型在相关时**按需**拉取技能正文。
3. 保留「默认 ∪ 勾选」的会话生效语义与 allowlist 约束。
4. 向后兼容：老技能（无描述）与「必须常驻」的技能仍可全量注入。

## 3. 非目标

- 不实现文件目录式技能（`SKILL.md` + `scripts/` + `references/`）；本期仍是配置项 JSON。
- 不实现技能的自动改写/学习。

---

## 4. 设计

### 4.1 两级信息

| 层级 | 内容 | 进入 system prompt？ |
|---|---|---|
| 元数据（catalog） | `id`、`name`、`description`、`whenToUse`（可选） | 是（一行一条） |
| 正文（body） | `prompt`（完整方法/视角） | 否；`load_skill` 按需返回 |

system prompt 中的广告形如：

```
可用技能（需要时用 load_skill 获取详细方法，不要臆测其内容）：
- [sk_3] 收入舞弊排查：识别收入确认异常与截止性测试思路。
- [sk_5] 关联方交易：梳理关联方资金往来的核对要点。
```

### 4.2 技能 schema 扩展

`SkillBody` / `SkillPatch`（`api/skills.py`）新增：

```python
description: str | None = None    # 一句话描述，用于广告（必填推荐）
whenToUse: str | None = None      # 何时使用（可选，进一步提示模型）
eager: bool = False               # True=仍全量注入正文（向后兼容逃生口）
```

- `prompt` 仍是正文，语义不变。
- 兼容：`description` 缺省时，路由/存储层从 `prompt` 首行截取（如无则用 `name`）。

### 4.3 后端

**`store/skills.py` 新增：**

```python
def catalog_for(root, skill_ids) -> list[dict]:
    """生效技能的元数据（id/name/description/whenToUse），剔除 prompt 正文。"""

def get_prompt(root, skill_id) -> dict | None:
    """按 id 取技能正文（供 load_skill），未启用/不存在返回 None。"""

def effective_ids(root, skill_ids) -> set[str]:
    """默认(enabled∧isDefault) ∪ 勾选(enabled∧id∈skillIds) 的 id 集合。"""
```

**`agent/prompts.py`：**

- 新增 `skill_catalog: list[dict] | None` 参数，渲染广告行；
- 保留 `skills`（正文）参数用于 `eager=True` 的技能；
- 无描述的老技能默认降级为……见 §4.5。

**新增工具 `tools/load_skill.py`：**

```python
def load_skill(root, params, *, allowed_skill_ids):
    skill = get_prompt(root, params["skillId"])
    if skill is None or skill["id"] not in allowed_skill_ids:
        return {"error": "not_allowed"}
    return {"id": skill["id"], "name": skill["name"], "prompt": skill["prompt"]}
```

**`tools/registry.py`：**

- 新增 `LoadSkillArgs(skillId: str)`；
- 在 `_SPECS` 注册 `load_skill`；
- 通过 `_context_wrapper` 注入 `allowedSkillIds`（与 `allowedConnectionIds`/`allowedProviderIds` 同一套机制）。

**`agent/graph.py`：**

- `_registry_context` 增加 `allowedSkillIds = effective_ids(root, context.skillIds)`；
- 用 `skill_catalog = catalog_for(...)` 替换 `skill_prompts`（仅当未启用 eager 兼容模式）；
- `eager` 技能仍走 `prompts_for` 全量注入。

### 4.4 应用设置开关

`store/app_settings.py` 新增（全局）：

```jsonc
{ "skills": { "mode": "lazy" } }   // "lazy" | "eager"
```

- `eager`：维持旧行为（全量注入），用于回滚/兼容。
- `lazy`：默认，走广告 + `load_skill`。

### 4.5 向后兼容矩阵

| 技能形态 | lazy 模式下行为 |
|---|---|
| 有 `description` | 广告 metadata，按需加载 |
| 无 `description` | 从 `prompt` 首行生成描述；仍按需加载 |
| `eager=true` | 无视 lazy，全量注入正文（逃生口） |
| 全局 `mode=eager` | 全部全量注入（等同旧行为） |

### 4.6 与上下文压缩的关系

- 广告只占数行 → system prompt 显著缩小 → 为对话历史让出预算（压缩文档 §4.1）。
- `load_skill` 的返回进入 tool 消息，随历史增长；压缩时与其它 tool 结果一视同仁。

---

## 5. 风险

1. **模型不调用 `load_skill`**：可能缺少方法细节。缓解：广告中明确「何时用」；提供 `eager` 逃生口；在 system prompt 里强调相关时必须加载。
2. **多一次工具往返**：增加一步延迟。缓解：技能通常一次加载后正文留在历史里（后续轮次无需重复加载，除非被压缩）。
3. **allowlist 漏洞**：必须确保 `load_skill` 只返回会话生效集合内的技能（默认∪勾选 ∧ enabled）。
4. **老客户端**：`SkillForm` 未提供 `description` 字段时后端自动生成，不阻塞。

## 6. 测试

- [ ] `catalog_for`：只含生效技能、只含元数据（无 `prompt`）。
- [ ] `effective_ids`：默认∪勾选 ∧ enabled。
- [ ] `load_skill`：命中返回正文；未启用/越权返回 `not_allowed`。
- [ ] lazy 模式：system prompt 含广告、不含正文。
- [ ] eager 技能：仍全量注入正文。
- [ ] `mode=eager`：等同旧行为。
- [ ] 无描述技能：自动生成描述。
- [ ] 回归：会话上下文栏（`skillIds`）勾选与默认语义不变。

## 7. 任务拆解

- [ ] T1 `api/skills.py`：`SkillBody`/`SkillPatch` 增 `description`/`whenToUse`/`eager`。
- [ ] T2 `store/skills.py`：`catalog_for` / `get_prompt` / `effective_ids`（含描述兜底）。
- [ ] T3 `agent/prompts.py`：`skill_catalog` 渲染。
- [ ] T4 新增 `tools/load_skill.py` + `tools/registry.py` 注册 + 上下文注入。
- [ ] T5 `agent/graph.py`：`_registry_context` 增 `allowedSkillIds`；catalog 注入。
- [ ] T6 `store/app_settings.py`：`skills.mode`。
- [ ] T7 前端：`SkillForm` 增加描述/何时用字段（可选）。
- [ ] T8 测试 + 文档。

## 8. 待决问题

1. 技能是否要支持引用**工作区文件**（类似 `SKILL.md` 的 `references/`）？本期不做，可作后续。
2. `whenToUse` 是否必要，还是仅 `description` 足够？
3. 广告行数上限（技能很多时是否只广告前 N 个）？
