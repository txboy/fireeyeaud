# Phase 9 · MCP 接入（MCP Tool Integration）

- 日期：2026-10-15
- 状态：**未实现**（本文为设计方案；仓库中 MCP **仅有配置 CRUD，未加载、未执行**）
- 关联模块：`store/mcp.py`、`api/mcp.py`、`tools/registry.py`、`agent/graph.py`、`agent/prompts.py`、`store/secrets.py`、`main.py`、`services/agent/pyproject.toml`
- 相关文档：[上下文压缩](./2026-10-15-agent-context-compaction.md)、[技能按需加载](./2026-10-15-skills-on-demand-loading.md)

> **本文实现的功能目前不存在。** 目前 MCP 只是「配置面板」：能增删改查 Server，但不会真正连接、发现或调用其工具。`tools/registry.py` 顶部注释明确写着「MCP 封装推迟 Phase 6」，而 Phase 6 实际只做了配置面板（见 `docs/plans/2026-10-10-phase6-websearch-mcp-packaging.md`，其 Goal 即「配置级，不真实执行 MCP」）。

---

## 1. 背景与现状（as-is）

### 1.1 已有：配置存储 + CRUD 路由

`store/mcp.py`：`list_servers` / `get_server` / `create_server` / `update_server` / `delete_server`，配置项落在 scope 感知的 `config.store`（`mcp.json`）。

`api/mcp.py`（`main.py:69` 注册，前缀 `/api/v1`）：

```
GET    /api/v1/mcp/servers
POST   /api/v1/mcp/servers
PATCH  /api/v1/mcp/servers/{server_id}
DELETE /api/v1/mcp/servers/{server_id}
```

### 1.2 Server 配置字段（`api/mcp.py::ServerBody`）

| 字段 | 说明 |
|---|---|
| `name` | 名称 |
| `transport` | `stdio` \| `sse` \| `http`（`store/mcp.py::_TRANSPORTS` 校验） |
| `command` / `args` / `env` | stdio 传输 |
| `url` | sse / http 传输 |
| `apiKeyRef` / `apiKeyEnv` | 凭据引用 |
| `enabled` | 启用开关 |
| `scope` | global / project |
| `isDefault` | 是否默认提供给模型 |
| `permissions` | `{ fsScope: "workspace", net: bool, toolsAllow: [string] }`（`store/mcp.py` 归一化默认值） |

### 1.3 现状事实

| 事实 | 位置 | 影响 |
|---|---|---|
| 无 MCP 客户端依赖 | `pyproject.toml` 无 `mcp` / `langchain-mcp-adapters` | 无法连接 |
| 工具集固定 | `tools/registry.py::_specs` 仅内置工具 | MCP 工具无法进入模型 |
| `mcpServerIds` 已被接收但被丢弃 | `api/sessions.py::ChatBody.mcpServerIds` → `context["mcpServerIds"]`；`graph.py::_registry_context` 不消费 | 勾选无效果 |
| 凭据仅内存 | `store/secrets.py::get(ref)` | HTTP 传输取 key 的现成通道 |
| 无连通性测试 | `api/mcp.py` 无 test 路由 | 用户无法验证配置 |

---

## 2. 目标

1. 按 `stdio` / `sse` / `http` 三种传输**真实连接**已启用且会话生效的 MCP Server。
2. **发现**其工具（`tools/list`），按 Server 的 `toolsAllow` 过滤，包装成 LangChain 工具供模型调用。
3. **调用**（`tools/call`）结果归一化为文本/结构化，走既有 `tool_call` / `tool_result` SSE 事件与 evidence 留痕。
4. 强制安全边界：默认关闭、显式启用、allowlist、工作区沙箱、超时与输出上限。
5. 提供连通性测试与工具列表预览。
6. 优雅降级：单个 Server 连接失败不影响本轮对话。

## 3. 非目标

- 不实现 MCP 的 resources / prompts / sampling 原语（仅 tools）。
- 不实现 OAuth 交互式授权（本期：静态 key 经 safeStorage → `store/secrets`）。
- 不改动前端 MCP 配置表单结构（仅新增「测试连接」「查看工具」）。

---

## 4. 架构

```
graph.run_agent (async)
   │  计算 allowed_mcp_ids = 默认(enabled∧isDefault) ∪ 勾选(mcpServerIds)
   ▼
build_mcp_tools(root, allowed_mcp_ids)  ← 新增（async）
   │  对每个 server：连接 → tools/list → 过滤 toolsAllow → 包装 StructuredTool
   ▼
tools 列表 = 内置工具 + load_skill + MCP 工具
   │  绑定到模型；执行时经 execute_tool 路由（已有 callId/evidence/事件）
```

---

## 5. 设计

### 5.1 依赖

`services/agent/pyproject.toml` `dependencies` 增加：

```
"mcp>=1.0.0",
```

（可选）`langchain-mcp-adapters`：若采用可直接把 MCP 工具转 `StructuredTool`；否则手写适配。**倾向手写适配**，以复用现有 `_context_wrapper` allowlist 与 evidence 机制，避免引入过重的转换层。

### 5.2 连接管理（新增 `mcp/` 包）

> 与 `store/mcp.py`（配置）区分：执行层放 `src/fireeyeaud_agent/mcp/`。

```
mcp/
  __init__.py
  client.py     # 每 server 的连接会话（stdio/sse/http）
  adapters.py   # MCP Tool → LangChain StructuredTool
  manager.py    # 连接池 / 生命周期 / 工具缓存
```

- **生命周期**：每次 `run_agent` 开始时按需连接，`finally` 关闭；不做跨轮常驻（简单、无状态泄漏；后续可加连接池）。
- **缓存**：`tools/list` 结果按 `serverId + 配置指纹` 缓存到内存，避免每轮重发现。
- **超时**：连接超时、`tools/call` 超时（新增 `FIREYEAUD_MCP_TIMEOUT_SECONDS`，默认 30s）。

### 5.3 工具命名与 schema

- 命名：`mcp__<serverId>__<toolName>`（双下划线避免与内置工具/其它 server 冲突）。
- 描述：`[name] original description`。
- 参数 schema：由 MCP 的 JSON Schema 映射为 pydantic 模型，或直接用 `StructuredTool.from_function` + `args_schema`（动态 `create_model`）。
- 结果：MCP `content`（text/image/resource）→ 文本拼接；纯文本优先，非文本以摘要占位（与 `_summarize` 兼容）。

### 5.4 权限与 allowlist（关键安全项）

生效集合：`enabled ∧ (isDefault ∨ id ∈ mcpServerIds)`。

逐 Server 叠加限制：

| 限制 | 来源 | 行为 |
|---|---|---|
| 工具白名单 | `permissions.toolsAllow` | 非空时仅暴露其中工具 |
| 文件系统范围 | `permissions.fsScope="workspace"` | stdio 子进程 cwd = 工作区根；注入 `FIREYEAUD_WORKSPACE` 环境变量 |
| 网络 | `permissions.net` | `false` 时不进行网络传输（HTTP/SSE 直接拒绝；stdio 无法真正阻断，需在 UI 明示） |
| 默认关闭 | `enabled=false` | 不连接 |

- **默认拒绝**：`toolsAllow` 为空时是否放行全部？建议**默认仅暴露显式列出的工具**（更安全），或在 UI 提供「允许全部」开关。见 §8 待决。
- 与其它资源一致：`isDefault` 自动生效、非默认需勾选（会话上下文栏 `mcpServerIds`）。

### 5.5 凭据

- HTTP/SSE：`apiKeyRef` → `store/secrets.get(ref)`，作为 `Authorization` 头或 MCP 规定的鉴权字段。
- stdio：`apiKeyEnv` 指向的环境变量名，从 `store/secrets` 取值后合并进子进程 `env`；**不写日志、不落盘**（延续 §17.2 策略）。

### 5.6 事件与留痕

- 复用现有 `tool_call` / `tool_result`（`graph.py:410-446`）：MCP 调用自动写 `evidence.jsonl`（工具名含 server 标识），与内置工具一致。
- 失败：`tool_result.ok=false`，`summary` 为错误摘要；不中断本轮其它工具。
- 可选：新增 `mcp_status` 事件用于 UI 显示连接态。

### 5.7 API 新增

```
POST /api/v1/mcp/servers/{id}/test    # 连接 + tools/list，返回 {ok, tools:[{name,description}], error?}
GET  /api/v1/mcp/servers/{id}/tools   # 预览（带短 TTL 缓存）
```

### 5.8 打包与运行时

- PyInstaller（`fireeyeaud-agent.spec`）需收集 `mcp` 包及其数据文件。
- **stdio 服务器依赖外部运行时**（如 Node `npx @modelcontextprotocol/server-*`）：需在文档/UI 中说明「用户机器需具备对应运行时」；不能假设随包分发。

---

## 6. 风险（按严重度）

1. **第三方子进程执行（最高）**：stdio MCP 会以 sidecar 权限运行任意命令。缓解：
   - 默认关闭 + 显式启用 + UI 二次确认；
   - 命令白名单/黑名单校验（拒绝明显危险命令）；
   - cwd 锁定工作区、超时、CPU/输出上限；
   - 文档明示「仅添加可信 Server」。
2. **网络外泄**：HTTP/SSE 可把工作区数据发往外部。缓解：`permissions.net` 门控 + UI 明示（设计与 §17 安全一致）。
3. **工具命名冲突 / schema 转换失败**：前缀 + 动态 schema 校验，转换失败则跳过该工具并告警。
4. **连接不稳定 / 挂起**：连接与调用均设超时；失败隔离到单 Server。
5. **打包膨胀**：`mcp` SDK 及其传递依赖增大 sidecar 体积。

## 7. 测试

- [ ] 假 MCP Server（stdio echo，pytest fixture 启动）→ 发现工具、调用并返回。
- [ ] JSON Schema → pydantic 转换（含 optional / enum / nested）。
- [ ] `toolsAllow` 过滤：不在白名单的工具不暴露。
- [ ] allowlist：未启用 / 未勾选 / 非默认的 server 不连接。
- [ ] 超时：连接超时与 `tools/call` 超时均返回错误而不挂起。
- [ ] 失败隔离：一个 server 抛错不影响内置工具与其它 server。
- [ ] 凭据：`apiKeyRef` 从 `store/secrets` 解析并注入（断言不落日志）。
- [ ] evidence：MCP 调用写入 `evidence.jsonl`（tool 名含 server 标识）。
- [ ] `POST /mcp/servers/{id}/test` 返回工具列表 / 错误。

## 8. 任务拆解

- [ ] T1 `pyproject.toml` 增 `mcp` 依赖；确认 PyInstaller 收集规则。
- [ ] T2 新增 `mcp/client.py`：三传输连接 + `tools/list` + `tools/call`。
- [ ] T3 新增 `mcp/adapters.py`：MCP Tool → `StructuredTool`（动态 schema、命名前缀）。
- [ ] T4 新增 `mcp/manager.py`：按 effective ids 连接、缓存、关闭、失败隔离。
- [ ] T5 `tools/registry.py` + `agent/graph.py`：`build_mcp_tools` 并入工具列表与 `tool_dict`。
- [ ] T6 `agent/graph.py::_registry_context`：消费 `mcpServerIds`，与 `permissions` 合并出运行期约束。
- [ ] T7 凭据：`apiKeyRef`/`apiKeyEnv` 经 `store/secrets` 注入。
- [ ] T8 `api/mcp.py`：`/test` 与 `/tools` 路由。
- [ ] T9 `agent/prompts.py`：system prompt 增加「已连接 MCP 工具」说明与不可信数据规则（沿用 §10）。
- [ ] T10 前端：MCP 表单加「测试连接 / 查看工具」；连接态展示。
- [ ] T11 测试 + 文档。

## 9. 待决问题

1. `toolsAllow` 为空时的默认策略：**拒绝全部**（最安全）还是**允许全部**（易用）？
2. 连接是否跨轮常驻（连接池）还是每轮建立？本期倾向每轮建立。
3. 是否支持 MCP 原生资源（resources）与提示模板（prompts）？本期仅 tools。
4. stdio 运行时依赖如何在安装/首次使用时检测并提示？
