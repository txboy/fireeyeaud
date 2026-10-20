# 表数据预览：AI 生成 SQL 助手

> 给「火眼审计助手」(fireeyeaud) 的表数据预览增加自然语言生成 SQL 的侧边助手。
> 状态：**待实现**（2026-10-21）。
> 前置：`docs/plans/2026-10-14-db-table-data-preview.md`（已实现）。

## 背景

表数据预览目前只有 SQL 编辑器 + 运行 + 分页。审计人员需要手写 SQL 才能完成筛选、聚合、
关联等查询，对不熟悉 SQL 的用户门槛较高。

目标：在预览页提供「AI 生成 SQL」入口，通过自然语言对话生成只读 SQL，并支持
**填入编辑器**与**直接运行**两种落地方式。生成结果直接显示在现有结果区域，不改变现有
编辑器、运行、分页、错误提示和实时语法诊断行为。

## 已确认的决策

1. **入口位置**：`AI 生成 SQL` 按钮放在现有「运行」按钮**左侧**。
2. **面板形态**：点击后右侧出现 LLM 聊天面板，约占整个右侧区域的 **1/3**；
   主区域（编辑器 + 结果）占 2/3。
3. **不进会话列表**：SQL 助手是独立轻量对话，不复用 `AgentColumn` / 现有会话体系，
   不写入后端会话表。
4. **按表保存**：每张表对应一个独立对话记录，key 使用现有 tab id
   `dbData:{connectionId}:{table}`。
5. **关闭保留**：关闭面板不删除对话；重新打开可继续。面板提供「清空聊天」。
6. **双操作**：每个生成的 SQL 代码块提供「填入编辑器」和「直接运行」两个按钮。
7. **结果落点**：「直接运行」的结果显示在中间数据区域（现有结果表格 + 分页）。
8. **上下文**：Agent 可获得数据库类型、表结构、当前 SQL、最近执行 SQL、当前页结果样本
   （前 20 行）、错误、分页信息。
9. **不引入独立 LSP 进程**，实时诊断继续使用现有 `/db/validate-sql`。
10. 助手第一版仅保存在前端内存，不写后端；应用重启或切换工作区后清空。

## 交互与布局

### 入口

`DbDataView` 的 `.dbdata__actions` 中，在「运行」按钮左侧新增：

```
[✨ AI 生成 SQL]  [▶ 运行]
```

- 图标使用 `lucide-react` 的 `Sparkles`。
- 点击切换面板开合；再次点击或点面板右上角 × 收起。
- 面板开合状态按 tab 记录，切换表再回来保持原状态。

### 双栏布局

`.formtab__head` 保持整行；其下拆成左右两栏：

```
┌──────────────────────────────────────────────┐
│ 表名 / 表                                    │
├───────────────────────────┬──────────────────┤
│ SQL 编辑器 + 操作按钮      │  SQL 助手        │
│ 错误提示                   │  ────────────    │
│ 已执行 SQL                 │  消息流          │
│ 结果表格 + 分页            │  ────────────    │
│                           │  输入框          │
└───────────────────────────┴──────────────────┘
         约 2/3                  约 1/3（≥300px）
```

CSS 方案：

```css
.dbdata__body {
  display: flex;
  min-height: 0;
  flex: 1;
}
.dbdata__main {
  flex: 1 1 auto;
  min-width: 0;              /* 保证结果表格横向滚动而不是挤压助手 */
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.dbdata__assistant {
  flex: 0 1 clamp(300px, 33%, 520px);
  min-width: 300px;
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
```

- 面板打开时根节点加 `dbdata--with-assistant`，不打开时保持现有单列布局。
- 窄窗口下助手列保持 300px，主列压缩；不做抽屉/浮层。
- 助手内部 `overflow: hidden`，仅消息区滚动。

### 面板内容

- **头部**：`SQL 助手` 标题、当前表名、清空按钮（`Trash2`，带确认）、关闭按钮（`X`）。
- **消息区**：
  - 空状态：`描述你想查询的数据，我会生成只读 SQL`，下方给 2~3 个示例提示
    （如「统计本月各科目发生额」「查询金额大于 100 万的凭证」），点击填入输入框。
  - 用户消息右对齐，助手消息左对齐。
  - 助手消息用现有 `Markdown` 组件渲染；流式期间 `plain`，结束后高亮。
  - 生成中显示光标/三点动画；用户向上翻阅时不强制滚到底部。
- **输入区**：
  - 多行 `textarea`，Enter 发送、Shift+Enter 换行。
  - 生成中发送按钮变为「停止」，点击 abort。
  - 生成中禁止重复发送；空内容不可发送。
  - 底部提示 `只生成只读查询，执行前请确认`。

### SQL 代码块双操作

助手回复中的 ```sql 代码块，在原有「复制」按钮左侧增加：

| 按钮 | 行为 |
|---|---|
| 填入编辑器 | 将该段 SQL 写入 `DbDataView` 的 `sql` state，保留面板与对话；编辑器实时语法诊断立即生效 |
| 直接运行 | 写入编辑器，并立即执行第 1 页；结果显示在主区域，保留面板 |

实现要求：

- `Markdown` 新增可选 `sqlActions`，只有传入时才渲染按钮，普通聊天完全不受影响。
- 仅当代码块语言为 `sql` / `mysql` / `postgres` / `postgresql` / `sqlite` / `tsql` /
  `plsql` 时启用。
- 「直接运行」不能只依赖 `setSql` 后调用 `handleRun()`：React state 异步更新会跑到旧 SQL。
  因此 `fetchPage` 增加显式 `sqlOverride` 参数：

```ts
const fetchPage = async (
  nextPage: number,
  includeTotal: boolean,
  size: number,
  sqlOverride?: string,
) => {
  const execSql = sqlOverride ?? sql;
  ...
  const res = await runDbQuery(tab.connectionId, tab.scope, {
    sql: execSql,
    limit: size,
    offset: (nextPage - 1) * size,
    includeTotal,
  });
  ...
};
```

- 面板回调由 `DbDataView` 注入：

```tsx
<DbSqlAssistantPanel
  tab={tab}
  sql={sql}
  result={result}
  error={errorKey ? terr(errorKey.replace(/^error\./, '')) : null}
  page={page}
  pageSize={pageSize}
  total={total}
  onInsert={(next) => setSql(next)}
  onRun={(next) => {
    setSql(next);
    void fetchPage(1, true, pageSize, next);
  }}
/>
```

## 前端设计

### 1. 对话 store：`apps/renderer/src/store/dbSqlAssistant.ts`

```ts
export interface DbSqlMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  interrupted?: boolean;
}

export interface DbSqlThread {
  open: boolean;
  messages: DbSqlMessage[];
  busy: boolean;
  errorKey: string | null;
}

interface DbSqlAssistantState {
  threads: Record<string, DbSqlThread>;
  setOpen: (tabId: string, open: boolean) => void;
  appendUser: (tabId: string, content: string) => DbSqlMessage;
  startAssistant: (tabId: string) => DbSqlMessage;
  appendDelta: (tabId: string, messageId: string, delta: string) => void;
  finish: (tabId: string, messageId: string, interrupted?: boolean) => void;
  fail: (tabId: string, messageId: string, errorKey: string) => void;
  clearThread: (tabId: string) => void;
  clearAll: () => void;
}
```

- `controllers` 用模块级 `Map<string, AbortController>`，不放进 zustand state。
- 默认线程 `{ open: false, messages: [], busy: false, errorKey: null }`，按需初始化。
- 关闭面板只 `setOpen(false)`，不动消息；`clearAll` 同时 abort 所有请求。
- 发送逻辑放在面板组件内（或 hook `useDbSqlAssistant`），store 只做状态更新。

### 2. 上下文构建：`apps/renderer/src/lib/dbSqlContext.ts`

```ts
export interface DbSqlContextInput {
  tab: DbDataTab;
  tables: DbTableSchema[];
  currentSql: string;
  executedSql: string | null;
  result: DbQueryResult | null;
  error: string | null;
  page: number;
  pageSize: number;
  total: number | null;
}

export function buildDbSqlContext(input: DbSqlContextInput): DbSqlChatContext;
```

输出结构：

```ts
interface DbSqlChatContext {
  connection: { id: string; name: string; driver: DbDriver; database: string | null };
  table: { name: string; columns: DbColumnSchema[] };
  tables: Array<{ name: string; columns: DbColumnSchema[]; truncated?: boolean }>;
  tablesTruncated: boolean;
  currentSql: string;
  executedSql: string | null;
  result: { columns: string[]; rows: unknown[][] } | null;
  resultTruncated: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  total: number | null;
}
```

限制与裁剪：

- 当前表列最多 **80** 列；其他表每表最多 **40** 列。
- 表总数最多 **40** 张，当前表始终保留。
- 结果只取当前页前 **20** 行，每行最多 100 列；单元格字符串超过 **500** 字符截断并加 `…`。
- 整个 context 序列化后约 **60KB** 上限（`JSON.stringify` 长度）。
- 超限时按顺序裁剪：
  1. 丢弃非当前表结构（保留表名 + 列名）；
  2. 结果行从尾部减少；
  3. 结果列从尾部减少；
  4. 其他表结构只保留表名。
- 任一步发生裁剪，置 `tablesTruncated` / `resultTruncated`。
- **不包含**密码、`credRef`、主机连接串、授权信息。

历史消息随请求发送最近 **20** 条、总量不超过 **40KB**；由组件组装请求体。

### 3. SSE 请求：`apps/renderer/src/lib/api.ts`

复用现有 `safeFetch` / `consumeSse` 的 POST + ReadableStream 模式，新增：

```ts
export interface DbSqlChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DbSqlSseEvent {
  type: 'status' | 'token' | 'done' | 'error';
  seq: number;
  ts: string;
  data: {
    phase?: string;
    delta?: string;
    messageKey?: string;
    usage?: Record<string, unknown>;
  };
}

export interface DbSqlChatInput {
  scope: ConfigScope;
  connectionId: string;
  table: string;
  driver: DbDriver;
  messages: DbSqlChatMessage[];
  context: DbSqlChatContext;
  locale?: string;
  modelId?: string | null;
}

export async function streamDbSqlChat(
  input: DbSqlChatInput,
  handlers: { onEvent: (event: DbSqlSseEvent) => void; signal?: AbortSignal },
): Promise<void>;
```

`consumeSse` 当前签名绑定 `SseEvent`，改为泛型或新增一个本地解析函数：

```ts
async function consumeSseGeneric<T>(
  res: Response,
  onEvent: (event: T) => void,
): Promise<void>
```

保持现有 `consumeSse` 行为不变，避免影响普通聊天。

### 4. 组件：`apps/renderer/src/components/DbSqlAssistantPanel.tsx`

职责：

- 从 store 读取当前 `tab.id` 的线程。
- 组装并发送请求，处理 `token` / `done` / `error`。
- 渲染消息、Markdown、SQL 双操作、输入框、清空确认。
- 不直接执行 SQL，全部通过 `onInsert` / `onRun` 回调交给 `DbDataView`。

发送流程：

```ts
const send = async (text: string) => {
  if (!text.trim() || thread.busy) return;
  store.appendUser(tab.id, text.trim());
  const assistant = store.startAssistant(tab.id);
  const controller = new AbortController();
  controllers.set(tab.id, controller);
  try {
    await streamDbSqlChat(
      {
        scope: tab.scope,
        connectionId: tab.connectionId,
        table: tab.table.table,
        driver: tab.driver,
        messages: [...history, { role: 'user', content: text.trim() }],
        context: buildDbSqlContext({ ... }),
        locale,
        modelId: selectedModelId,
      },
      {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'token') {
            store.appendDelta(tab.id, assistant.id, event.data.delta ?? '');
          } else if (event.type === 'error') {
            store.fail(tab.id, assistant.id, event.data.messageKey ?? 'error.internal');
          }
        },
      },
    );
    store.finish(tab.id, assistant.id);
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      store.finish(tab.id, assistant.id, true);
    } else {
      store.fail(
        tab.id,
        assistant.id,
        (err as { messageKey?: string }).messageKey ?? 'error.internal',
      );
    }
  } finally {
    controllers.delete(tab.id);
  }
};
```

模型选择：

- 复用现有设置里的默认模型；若现有 chat store 暴露 `modelId` 选择，可直接读取。
- 第一版不新增模型选择器，使用后端默认 `build_chat_model(root, null)`。
- 请求体保留 `modelId` 字段，便于后续扩展。

错误展示：

- 助手消息下方红色小字显示本地化错误。
- `error.llmUnavailable` 时额外提示「请在设置中配置模型」。
- 错误不写入消息正文，下一次发送仍可正常进行。

清空：

- 使用现有确认对话框（若有）或 `window.confirm` 的本地化文案。
- 清空当前表消息、错误与进行中的请求。

### 5. `DbDataView` 改造

- 根节点：

```tsx
<div className={`formtab dbdata${open ? ' dbdata--with-assistant' : ''}`}>
  <div className="formtab__head">...</div>
  <div className="dbdata__body">
    <div className="dbdata__main">
      {/* 现有 editor / execsql / result / pager */}
    </div>
    {open && <DbSqlAssistantPanel ... />}
  </div>
</div>
```

- `fetchPage` 增加 `sqlOverride`，其余调用处保持不变。
- 新增 `assistantOpen`，从 `useDbSqlAssistantStore` 读取与切换。
- AI 按钮 disabled 条件：`busy` 时不禁止打开（允许查看历史），仅发送受限。
- 传给面板的 `error` 已是本地化文本，避免后端/模型看到 i18n key。

### 6. `Markdown` 改造

```ts
export interface SqlActions {
  insertLabel: string;
  runLabel: string;
  insertTitle?: string;
  runTitle?: string;
  onInsert: (sql: string) => void;
  onRun: (sql: string) => void;
}

interface MarkdownProps {
  content: string;
  plain?: boolean;
  sqlActions?: SqlActions;
}
```

- `CodeBlock` 接收 `sqlActions`；语言匹配 SQL 系时在头部渲染按钮。
- 按钮样式复用 `.md-code__copy` 的紧凑图标按钮，或在旁边加文字按钮
  `.md-code__action`。
- `components` 的 `useMemo` 依赖增加 `sqlActions`。
- 不影响普通聊天：不传时行为完全不变。
- 点击后不关闭代码块、不自动复制。

## 后端设计

### 新增 `services/agent/src/fireeyeaud_agent/agent/sql_assistant.py`

```python
SYSTEM_PROMPT = """..."""

def build_sql_assistant_messages(
    *,
    context: dict[str, Any],
    history: list[dict[str, str]],
    locale: str | None,
) -> list[BaseMessage]: ...

def compact_context(context: dict[str, Any], *, max_chars: int = 60000) -> str: ...

async def stream_sql_assistant(
    *,
    root: Path | None,
    body: SqlChatBody,
) -> AsyncIterator[dict[str, Any]]: ...
```

系统提示词要求：

- 你是数据库查询助手，只生成**只读** SQL：`SELECT` / 聚合 / 子查询 / CTE / `EXPLAIN`。
- 禁止 `INSERT` / `UPDATE` / `DELETE` / `DROP` / `ALTER` / `CREATE` / `TRUNCATE` /
  存储过程调用 / 多语句。
- 严格使用给定驱动方言（PostgreSQL / MySQL / SQL Server / Oracle / SQLite / Access）。
- 只能使用上下文中给出的表和列；不得编造表名、列名、函数或值。
- 标识符引用遵循方言；Access 使用 `[]`，MySQL 使用反引号，其余双引号。
- 不确定需求时先提一个澄清问题，不要猜测。
- 不能声称「已执行」「已查到结果」；执行由用户点击按钮完成。
- 最终答案必须包含至少一个 ```sql 代码块；一段代码块只放一条可执行语句。
- 先给一句简短说明，再给 SQL；必要时说明筛选条件与假设。
- 上下文中的结果是样本，不代表全量数据；不要据此编造统计结论。
- 使用与用户相同的语言回复（`locale` 仅作参考）。

上下文组织：

```
[连接] driver / database
[当前表] name + columns(name, type, nullable, primaryKey)
[相关表] 最多 40 张
[当前 SQL]
[最近执行 SQL]
[当前结果] columns + 前 20 行（已截断）
[最近错误]
[分页] page / pageSize / total
[裁剪标记]
```

- 用紧凑 JSON 或表格文本，避免重复字段名浪费 token。
- `compact_context` 再做一次服务端兜底：超过 60KB 时优先删结果行和非当前表列。
- 服务端不信任前端：限制 `messages` 最多 40 条、单条 8000 字符、总 60KB，
  超限截断而不是报错。

### 新增路由 `POST /api/v1/db/sql-chat`

位置：`services/agent/src/fireeyeaud_agent/api/db.py`。

Pydantic 模型：

```python
class SqlChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str

class SqlChatBody(BaseModel):
    scope: str = "global"
    connectionId: str
    table: str
    driver: str
    messages: list[SqlChatMessage]
    context: dict[str, Any] = {}
    locale: str | None = None
    modelId: str | None = None
```

路由：

```python
@router.post("/db/sql-chat")
async def db_sql_chat(body: SqlChatBody) -> EventSourceResponse:
    root = workspace_manager.root
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    conn = db.get_connection(body.connectionId, body.scope, root)
    if conn is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": body.connectionId})
    # 只校验驱动/表名，不取密码、不连库
    return EventSourceResponse(stream_sql_assistant(root=root, body=body))
```

要点：

- 不调用 `db.get_secret`，不建立数据库连接。
- 连接存在性校验用于避免任意 connectionId 探测；驱动以服务端连接记录为准，
  与请求 `driver` 不一致时以服务端为准。
- 429/503 等非流式错误在响应建立前返回；流内错误通过 `error` 事件返回。
- 复用 `require_token` 依赖（router 级已有）。

### SSE 事件

与现有聊天一致，使用 `EventSourceResponse`，每条 `data` 为 JSON 字符串：

```json
{"type":"status","seq":1,"ts":"2026-10-21T10:00:00Z","data":{"phase":"thinking"}}
{"type":"token","seq":2,"ts":"...","data":{"delta":"可以"}}
{"type":"token","seq":3,"ts":"...","data":{"delta":"使用..."}}
{"type":"done","seq":4,"ts":"...","data":{"usage":{}}}
{"type":"error","seq":5,"ts":"...","data":{"messageKey":"error.llmUnavailable"}}
```

- 复用 `graph.py` 中 `now_iso()` 与事件封装思路，不在本模块引入会话概念。
- `sessionId` 字段可省略；前端仅依赖 `type` / `data`。
- 捕获 `ApiError` → `error` 事件（`messageKey` 原样透出）；其他异常 →
  `error.internal`，服务端记录日志。
- 客户端断开时停止迭代（`EventSourceResponse` 会取消生成器）。
- 模型调用使用 `build_chat_model(root, body.modelId)` + `astream(messages)`，
  逐 chunk 取文本增量；忽略空增量。

## 文案 key

在 `packages/shared/src/locales/{zh-CN,en-US}.ts` 的 `database` 命名空间新增：

| key | zh-CN | en-US |
|---|---|---|
| `aiGenerateSql` | AI 生成 SQL | Generate SQL with AI |
| `assistantTitle` | SQL 助手 | SQL assistant |
| `assistantEmpty` | 描述你想查询的数据，我会生成只读 SQL。 | Describe the data you need and I'll generate read-only SQL. |
| `assistantPlaceholder` | 例如：统计本月各科目发生额 | e.g. Sum amounts by account for this month |
| `assistantSend` | 发送 | Send |
| `assistantStop` | 停止 | Stop |
| `assistantThinking` | 正在生成… | Generating… |
| `assistantClear` | 清空聊天 | Clear chat |
| `assistantClearConfirm` | 清空当前表的聊天记录？ | Clear the chat history for this table? |
| `assistantInterrupted` | 已停止生成 | Generation stopped |
| `assistantReadonlyHint` | 只生成只读查询，执行前请确认。 | Read-only queries only. Review before running. |
| `assistantLlmMissing` | 尚未配置模型，请先在设置中配置。 | No model configured. Set one up in Settings. |
| `insertToEditor` | 填入编辑器 | Insert into editor |
| `runSql` | 运行 | Run |

- 错误文案复用现有 `error` 命名空间，不新增重复 key。
- SQL 代码块按钮文案通过 `sqlActions` 从 `database` 命名空间传入，
  `Markdown` 自身不依赖 `database` 命名空间。

## 边界与异常

| 场景 | 行为 |
|---|---|
| 未配置模型 | 面板内显示 `error.llmUnavailable` + 配置提示；编辑器不受影响 |
| 生成中关闭面板 | abort 请求，保留已生成内容并标记「已停止生成」 |
| 生成中切换表 | 各表独立线程；旧请求按 tab 单独 abort |
| 生成内容含写语句 | 系统提示词约束；用户「直接运行」仍会经过现有 `validate_sql` 只读校验并报错 |
| SQL 语法错误 | 填入后编辑器实时诊断标红；运行后主区域显示现有错误 |
| 运行报错 | 错误进入下一轮上下文，助手可基于错误修正 |
| 上下文过大 | 前端裁剪 + 后端兜底，标记截断 |
| 表格超宽 | 主列 `min-width: 0` + 表格横向滚动，不挤压助手 |
| 面板打开时无任何结果 | 上下文 `result: null`，助手只依据表结构生成 |
| 工作区切换 | `clearAll()` 清空所有线程并 abort |
| 应用重启 | 对话不保留（内存态） |
| 面板关闭再打开 | 历史保留 |

安全约束：

- 上下文永远不包含密码、凭据引用、连接串。
- 后端接口不执行 SQL、不读取数据、不返回表数据。
- 模型输出视为不可信文本，经 `Markdown` 转义/高亮渲染。
- 「直接运行」走现有只读校验，不新增执行通道。

## 测试

### 后端 `services/agent/tests/test_db_sql_assistant.py`

- `build_sql_assistant_messages`：
  - 系统提示词包含只读、方言、禁止编造、SQL 代码块等约束。
  - 历史消息顺序与角色正确。
  - 上下文中的表/列/结果/错误/分页被格式化进消息。
  - 超长上下文被裁剪并带截断标记。
- `compact_context`：
  - 结果行按上限截断。
  - 非当前表优先被裁掉。
  - 输出长度不超过上限。

### 后端 `services/agent/tests/test_db_sql_chat_api.py`

- 未打开工作区 → 409。
- 连接不存在 → 404。
- 正常请求 → `text/event-stream`，事件顺序 `status → token* → done`。
- 模型抛 `ApiError` → `error` 事件且 `messageKey` 正确。
- 请求不触发 `db.get_secret` / `db_engine.run_query`（用 monkeypatch 断言未调用）。
- `messages` 超限被截断而非 500。

模型流用 monkeypatch 替换 `build_chat_model`，返回一个假 `astream` 异步生成器。

### 前端

- `npm run renderer:build` 通过（TypeScript + Vite）。
- 无新增 ESLint 警告（若仓库启用了 lint）。

### 手动验收

1. 打开表预览 → 点「AI 生成 SQL」→ 面板占右侧约 1/3，主区域保持可用。
2. 提问「统计各科目金额」→ 流式输出 → SQL 代码块出现两个按钮。
3. 点「填入编辑器」→ 编辑器内容更新，语法诊断生效，面板与历史保留。
4. 点「直接运行」→ 主区域第 1 页显示结果，分页/总数正常，编辑器内容一致。
5. 生成一个错误 SQL 并运行 → 主区域报错 → 追问「修正上面的错误」→ 助手能引用错误。
6. 翻页、改页大小 → 助手上下文中的 page/pageSize/结果同步。
7. 关闭面板再打开 → 历史仍在；点「清空聊天」→ 仅当前表清空。
8. 打开两张表分别对话 → 消息互不干扰；关闭其中一张再打开仍保留。
9. 深色/浅色主题、窄窗口下布局正常，无横向溢出。
10. 未配置模型时发送 → 面板显示可读错误，不崩溃。

## 实施顺序

1. 后端 `sql_assistant.py`：提示词、上下文格式化、流式生成。
2. 后端路由 `/db/sql-chat` + Pydantic 模型。
3. 后端单元测试与接口测试。
4. `api.ts` 新增 SSE 请求与类型。
5. `dbSqlContext.ts` 上下文构建与裁剪。
6. `dbSqlAssistant.ts` 按 tab 线程 store。
7. `Markdown` 支持 `sqlActions`。
8. `DbSqlAssistantPanel` 组件。
9. `DbDataView` 双栏布局 + AI 按钮 + `sqlOverride` + 回调。
10. `global.css` 样式 + 中英文文案。
11. `App.tsx` 工作区切换时 `clearAll()`。
12. 运行测试、构建、手动验收。

## 涉及文件清单

新增：

- `services/agent/src/fireeyeaud_agent/agent/sql_assistant.py`
- `services/agent/tests/test_db_sql_assistant.py`
- `services/agent/tests/test_db_sql_chat_api.py`
- `apps/renderer/src/components/DbSqlAssistantPanel.tsx`
- `apps/renderer/src/store/dbSqlAssistant.ts`
- `apps/renderer/src/lib/dbSqlContext.ts`

修改：

- `services/agent/src/fireeyeaud_agent/api/db.py`
- `apps/renderer/src/components/DbDataView.tsx`
- `apps/renderer/src/components/Markdown.tsx`
- `apps/renderer/src/lib/api.ts`
- `apps/renderer/src/styles/global.css`
- `apps/renderer/src/App.tsx`
- `packages/shared/src/locales/zh-CN.ts`
- `packages/shared/src/locales/en-US.ts`

## 验证命令

```powershell
# 后端测试
cd services/agent
.\.venv\Scripts\python.exe -m pytest -q

# 前端构建
cd ..\..
npm run renderer:build

# 空白/格式检查
git diff --check
```

> 新增后端路由后需要重启 sidecar 才会生效；仅刷新前端不会加载新接口。

## 已知限制 / 后续

- 对话仅内存保存，重启丢失；若需跨重启，可后续写入工作区 JSON 或本地存储。
- 第一版不做模型选择器，使用系统默认模型。
- 不做服务端 SQL 语法预校验；语法错误由现有编辑器诊断与运行错误覆盖。
- 不做多轮自动执行（Agent 不直接查库），避免误执行与权限边界扩大。
