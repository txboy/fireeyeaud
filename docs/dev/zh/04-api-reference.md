# API 与协议

> English: [../en/04-api-reference.md](../en/04-api-reference.md)

后端是一个挂在 `http://127.0.0.1:<port>/api/v1` 的 REST 服务，另有若干 SSE 流式端点。

> 端口由 Electron 主进程动态分配（`findFreePort`），开发时单独跑 sidecar 是固定 8765。
> 完整端点清单以代码为准——本文只写约定和最常用的那一层，避免复制一份很快过期的接口表。
> 想拿全量清单：启动后端后访问 `/docs`（FastAPI 自动生成的 OpenAPI 页面）。

## 鉴权

所有业务 router 都声明了 `dependencies=[Depends(require_token)]`：

```
Authorization: Bearer <token>
```

- token 由主进程生成，通过环境变量 `FIREYEAUD_TOKEN` 注入 sidecar。
- **未设置该环境变量时不做校验**（开发环境便利）。打包后一定会设置。
- `/health` 不要求鉴权，用于启动探测。

## 错误包裹

非 2xx 一律返回统一结构：

```json
{
  "error": {
    "code": "E_NOT_FOUND",
    "messageKey": "error.notFound",
    "params": { "id": "F-0001" }
  }
}
```

前端 `lib/api/client.ts` 的 `toApiError()` 读这个结构，还原成 `ApiError`（带 `code` / `httpStatus` / `messageKey` / `params`）。

`messageKey` 是翻译键，必须在 `packages/shared/src/locales/{zh-CN,en-US}.ts` 的 `error` 命名空间里存在。

## SSE 流式端点

需要实时反馈的接口用 POST + SSE，返回 `text/event-stream`，每条消息一个 `data:` 行。

### 事件结构

```ts
interface SseEvent<T> {
  type: string;
  seq: number;       // 从 1 递增，前端按序处理
  sessionId: string;
  ts: string;        // ISO 时间
  data: T;
}
```

### 事件类型

| type | data | 说明 |
|---|---|---|
| `status` | `{ phase }` | 阶段变化：`planning` / `executing` / `reflecting` / `compacting` / `reading` |
| `context` | `{ options }` | 本次实际带给模型的资源快照（模型/数据库/知识库/MCP/技能/规则） |
| `token` | `{ delta }` | 正文增量，前端追加到当前消息 |
| `tool_call` | `{ callId, tool, params }` | 工具调用开始 |
| `tool_result` | `{ callId, summary, ok }` | 工具结果摘要（完整结果不发给前端） |
| `notice` | `{ messageKey, params? }` | 提示（不中断流程） |
| `done` | `{ usage? , messageKey? }` | 结束。带 `messageKey` 表示以受限告警结束（如步数上限） |
| `error` | `{ messageKey, code?, params? }` | 出错并终止 |

### 返回 SSE 的端点

| 端点 | 用途 |
|---|---|
| `POST /sessions/{id}/chat` | 主对话（Agent 循环） |
| `POST /datasources/import` | 导入数据文件，推进度 |
| `POST /datasources/sync` | 数据源对账，推差异与结果 |
| `POST /db/sql-chat` | SQL 助手对话 |
| `POST /reports/{id}/chat` | 报告写作对话 |
| `POST /evidence-forms/{id}/chat` | 取证单写作对话 |

前端统一用 `lib/api/sse.ts` 的 `consumeSseGeneric` 消费，不要各写一份解析。

## 常用端点

### 工作区

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/health` | 健康检查（免鉴权），返回 `{ status, appVersion }` |
| `POST` | `/workspaces/open` | 打开工作区，`{ path }` |
| `GET` | `/workspaces/current` | 当前工作区信息 |
| `POST` | `/workspaces/close` | 关闭 |
| `POST` | `/workspaces/{id}/verify-evidence` | 校验证据哈希链 |

### 会话

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/sessions` | 新建会话 |
| `GET` | `/sessions` | 会话列表 |
| `PATCH` | `/sessions/{id}` | 重命名 |
| `DELETE` | `/sessions/{id}` | 删除 |
| `GET` | `/sessions/{id}/messages` | 消息列表 |
| `PATCH` | `/sessions/{id}/context` | 保存会话级上下文（勾选资源 + 模型） |
| `POST` | `/sessions/{id}/chat` | **SSE**，发消息 |

### 疑点与证据

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/findings` | 列表（支持筛选） |
| `POST` | `/findings` | 手工新建疑点，201 |
| `GET` | `/findings/{id}` | 详情 |
| `DELETE` | `/findings/{id}` | 删除 |
| `POST` | `/findings/{id}/review` | 复核：确认/驳回/复核中/误报/改级别 |
| `POST` | `/findings/{id}/evidence` | 挂接人工证据，201 |
| `DELETE` | `/findings/{id}/evidence/{eid}` | 移除证据 |
| `GET` | `/evidence` | 证据事件流 |
| `GET` | `/graph` | 证据图谱（`?findingId=` 聚焦），实时派生不落盘 |

### 数据源与数据库

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/datasources` | 数据源分页 |
| `POST` | `/datasources/import` | **SSE**，导入文件 |
| `POST` | `/datasources/sync` | **SSE**，对账 |
| `DELETE` | `/datasources/{id}` | 移除（不动磁盘原文件） |
| `GET` | `/datasources/workspace-duckdb/tables/{table}` | 工作区表结构 |
| `POST` | `/datasources/workspace-duckdb/query` | 工作区表只读查询 |
| `GET` | `/db/connections` | 连接列表（global ⊕ project） |
| `POST` | `/db/connections` | 新增连接 |
| `PATCH` | `/db/connections/{id}` | 修改 |
| `DELETE` | `/db/connections/{id}` | 删除 |
| `POST` | `/db/connections/{id}/test` | 测试已存连接 |
| `POST` | `/db/test` | 用临时参数测试（未保存） |
| `POST` | `/db/connections/{id}/reflect` | 反射表结构 → 注册为数据源 |
| `PATCH` | `/db/connections/{id}/authorization` | 保存表/字段白名单 |
| `POST` | `/db/validate-sql` | 纯语法校验，不连库 |
| `POST` | `/db/connections/{id}/query` | 只读查询 |

### 配置类（模式一致）

`models` / `rules` / `skills` / `kb/providers` / `mcp/servers` / `templates` 都是同一套：

```
GET    /<res>            列表（?scope=global|project）
POST   /<res>            新增
PATCH  /<res>/{id}       修改
DELETE /<res>/{id}       删除
POST   /<res>/{id}/test  连通性测试（models / kb / mcp 有）
```

### 报告与取证单

`reports` 与 `evidence-forms` 结构对称：

| 方法 | 报告 / 取证单 | 说明 |
|---|---|---|
| `POST` | `/reports/drafts` | 由模板 + 疑点建草稿，201 |
| `GET` | `/reports` | 列表 |
| `GET` | `/reports/{id}/doc` | 结构化正文 |
| `PUT` | `/reports/{id}/outline` | 设置大纲（需 `approved: true` 才能往下写） |
| `PUT` | `/reports/{id}/sections/{sid}` | 写某一节 |
| `PUT` | `/reports/{id}/title` | 改标题 |
| `POST` | `/reports/{id}/verify` | 校验（不通过则禁止导出） |
| `POST` | `/reports/{id}/export` | 导出 docx |
| `POST` | `/reports/{id}/chat` | **SSE**，写作对话 |

### 产出物

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/export/working-paper` | 底稿历史 |
| `POST` | `/export/working-paper` | 生成底稿 `{ format: word\|xlsx\|pdf, findingIds?, locale? }` |
| `GET` | `/artifacts/{path:path}` | 读产物（含目录穿越防护） |

### 归档

`/archive/status` `/archive/init` `/archive/commit` `/archive/history` `/archive/{id}/changes`
`/archive/remote` `/archive/push` `/archive/conflict/check` `/archive/conflict/resolve`
`/archive/clone` `/archive/restore` `/archive/author`

### 其它

`/settings` 读写全局设置、`/secrets` 由主进程推送密钥明文（进侧车后仅内存持有）。

## 配置作用域

几乎所有配置实体都有 `scope`：

- `global` 存在 `~/.fireeye/`，所有项目共享
- `project` 存在当前工作区 `.fireeye/config/`

读取时是 **global ⊕ project 合并，project 覆盖 global**。列表接口用 `?scope=` 指定要看哪一层。

## 新增端点的约定

1. 在 `api/` 下对应模块加 `@router.get/post/...`
2. 出错抛 `ApiError`，不要自己构造 JSONResponse
3. 需要实时反馈的才用 SSE，普通请求一律返回 JSON
4. 在 `packages/shared/src/types.ts` 定义请求/响应类型（如果前端要用）
5. 在 `apps/renderer/src/lib/api/<领域>.ts` 加前端封装