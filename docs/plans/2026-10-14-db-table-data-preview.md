# 表数据预览 tab

> 给「火眼审计助手」(fireeyeaud) 的数据库表预览功能。
> 状态：**已实现**（2026-10-14）。

## 背景

表授权 tab 只能看表/字段结构，无法直接查看数据。需求：在授权 tab 里每张表加「预览」按钮，
点击打开一个新的右侧 tab，顶部 SQL 输入框可运行，下方分页展示结果。

## 决策（已与用户确认）

1. **分页方式**：服务端分页（按方言生成 `LIMIT/OFFSET`、`OFFSET … FETCH NEXT …` 或 `TOP`）。默认查询按主键排序以保证翻页稳定。
2. **总行数/总页数**：显示。运行第 1 页时执行 `COUNT(*)` 取总数。
3. **授权**：预览**不受**「表/字段授权」限制（授权只约束 LLM/Agent；预览是审计人员本人查看数据）。
4. 一表一 tab（可多开对比）。

## 后端

### `services/agent/src/fireeyeaud_agent/store/db_engine.py`

- `run_query(conn, sql, password, limit=DEFAULT_LIMIT, offset=0)`
  - 若**最外层查询自带 LIMIT**（用 sqlglot 判断）、或为 EXPLAIN/DESCRIBE：**按原样执行**，不包装、不分页（`paginated=False`）。
  - 否则由 `_page_sql(driver, sql, limit, offset)` 生成「从 offset 起取 limit+1 行」的分页 SQL（`paginated=True`）：
    - PG/MySQL/SQLite：`SELECT * FROM (<sql>) AS _sub LIMIT {limit+1} OFFSET {offset}`。
    - **MSSQL**：T-SQL 不允许派生表里出现 ORDER BY，故**不包装**，直接在原 SQL 末尾追加
      `OFFSET {offset} ROWS FETCH NEXT {limit+1} ROWS ONLY`；原 SQL 无最外层 ORDER BY 时补 `ORDER BY (SELECT NULL)`。
    - **Access**：无 OFFSET，用 `SELECT TOP {offset+limit+1} * FROM (<sql>) AS _sub`，再由应用侧丢弃前 `offset` 行。
  - 返回：`{columns, rows, rowCount, hasMore, truncated, paginated, sql}`（`hasMore = 取到行数 > limit`；
    `truncated` 与 `hasMore` 同值，保留以兼容规则试跑；`sql` 为**实际执行的完整 SQL**）。
  - `limit` 继续夹在 `[1, MAX_LIMIT]`；`offset` 夹在 `>= 0`。
- 新增 `count_query(conn, sql, password) -> int | None`
  - `SELECT COUNT(*) FROM (<sql>) AS _sub`。
  - 失败（超时/不支持/解析失败）返回 `None`，不抛错、不阻断预览。
  - `EXPLAIN/DESCRIBE` 不适用 → 直接 `None`。

### `services/agent/src/fireeyeaud_agent/api/db.py`

- 新增路由 `POST /db/connections/{connection_id}/query`：
  - body：`{ sql: str, limit: int|None, offset: int|None, includeTotal: bool=True }`。
  - 流程：`db.get_connection`（404 若无）→ 取凭据 `db.get_secret(conn.credRef or id)` →
    `db_engine.run_query(...)`；`includeTotal` 为真时再 `db_engine.count_query(...)`。
  - 返回：`{ columns, rows, rowCount, hasMore, paginated, total, limit, offset, sql }`（`total` 可能为 `null`）。
  - **不**调用 `check_authorization`。
  - 只读由 `validate_sql` 强制：写语句 / 多语句 → `E_SQL_REJECTED`（现有错误码）。

## 前端

### `apps/renderer/src/store/ui.ts`
- 新增：
  ```ts
  export interface DbDataTab {
    id: string;              // `dbData:{connectionId}:{table}`
    kind: 'dbData';
    connectionId: string;
    scope: ConfigScope;
    name: string;            // 连接名，tab 标题用 `{连接}/{表}`
    driver: DbDriver;        // 默认 SQL 标识符转义
    table: DbTableSchema;    // 默认 SQL 的主键排序 + 展示用
  }
  ```
- `RightTab` 联合类型加 `DbDataTab`。
- `openDbData(input: { id; scope; name; driver; table })`：照 `openDbSchema` 的写法（allowLeave 守卫 + 去重 upsert）。

### `apps/renderer/src/components/RightArea.tsx`
- 图标：`dbData` → `Table2`。
- 标题：`dbData` → `{连接名} / {表名}`。
- body：`active.kind === 'dbData' ? <DbDataView key={active.id} tab={active as DbDataTab} />`。

### 新组件 `apps/renderer/src/components/DbDataView.tsx`
- 顶部工具条：
  - SQL `textarea`（`className="searchbox"`），默认 `SELECT * FROM <quoted> [ORDER BY <pk>]`。
  - 「运行」按钮（`Play` 图标）**居右**。
- 结果区：
  - 顶部显示**实际执行的完整 SQL**（含分页包装，来自结果里的 `sql` 字段），不在此处放分页条；提供**复制按钮**（`navigator.clipboard` + `execCommand` 回退），且文本可选中（覆盖 `body { user-select:none }`）。
  - 结果表格，表头吸顶、区域可滚动。
  - 分页条只在**表尾**、**居右**：`共 T 行 · 上一页 · 第 N / M 页 · 下一页 · 每页 [N]`（每页行数选择器在翻页之后）。
  - `paginated=false`（用户 SQL 自带 LIMIT / EXPLAIN 等）时只显示 `共 T 行 · 按原样执行（不分页）`，不出翻页控件。
  - `total` 为 `null` 时降级为 `第 N 页` + 用 `hasMore` 控制「下一页」。
- 状态：`sql`、`page`、`pageSize`、`result`、`total`、`busy`、`errorKey`。
- 逻辑：
  - 运行 → `page=1`，请求 `offset=0, includeTotal=true`，`total` 单独存 state（翻页不丢）。
  - 翻页 → 请求 `offset=(page-1)*pageSize, includeTotal=false`。
  - 改 SQL 后需重新「运行」才刷新；运行/翻页时 `busy` 禁用按钮。
  - 错误 → `.panel-error` + `terr(errorKey)`（`error.dbConn` / `error.sqlRejected` / `error.sqlTimeout` 等）。
  - 单元格：`null → —`，对象（JSON 等）→ `JSON.stringify`。
- 渲染防御：选择器只返回稳定引用（不要在选择器里造新对象，避免无限渲染）。

### `apps/renderer/src/components/DbSchemaView.tsx`
- 每张表头加「预览」按钮（`Table2` 图标 + 「预览」文字），
  `onClick → openDbData({ id: tab.connectionId, scope: tab.scope, name: tab.name, driver: <连接驱动>, table })`。
  （驱动从 `useDatabaseStore(s => s.items)` 按连接 id 查找，找不到回退 `'sqlite'`。）

### `apps/renderer/src/lib/api.ts`
- `runDbQuery(id, scope, {sql, limit, offset, includeTotal}) -> DbQueryResult`，`POST /db/connections/{id}/query?scope=…`。

### `packages/shared/src/types.ts`
- 新增：
  ```ts
  export interface DbQueryResult {
    columns: string[];
    rows: unknown[][];
    rowCount: number;
    total: number | null;
    hasMore: boolean;
    paginated: boolean;     // 是否可分页；自带 LIMIT / EXPLAIN 时为 false
    limit: number;
    offset: number;
    sql: string;            // 实际执行的完整 SQL（含分页包装）
  }
  ```

### 标识符转义（拼默认 SQL）
按 driver：PG/SQLite `"表"`；MySQL `` `表` ``；MSSQL/Access `[表]`。放在 `DbDataView` 内的小工具函数。

### 文案
`packages/shared/src/locales/zh-CN.ts` / `en-US.ts` 的 `database` 命名空间新增：
`preview, dataSql, run, pageSize, prevPage, nextPage, pageOf, pageNo, totalRows, noRows, loadingRows, executedSql, copy, copied, noPaging`。

### 样式
复用 `.formtab*` / `.searchbox` / `.button` / `.panel-error` / `.icon-btn`；
新增少量 `.dbdata*`（工具条、分页条、结果区滚动、表格吸顶）。

## 测试 / 验证

- 后端 TDD：新增 `services/agent/tests/test_db_query_api.py`
  - 正常查询：返回 `columns` / `rows` / `rowCount`。
  - `offset` 翻页：第二页内容正确、不重复第一页。
  - `includeTotal`：`total` 等于表行数。
  - 写操作 / 多语句 → `E_SQL_REJECTED`。
  - `limit` 超 `MAX_LIMIT` 被夹紧。
  - 引擎单测：`run_query` offset/hasMore、`count_query`（含失败返回 None）。
  - 先红后绿。
- 运行后端全量：`services/agent` 下 `.\.venv\Scripts\python.exe -m pytest`
  （`uv sync` 后 pypdf 刷新为 6.20，原 `test_pdf` 失败已消除 → 全绿）。
- 渲染层：`npm run renderer:typecheck`，只看改动文件是否报错（既有缺失依赖 `docx-preview` 等报错忽略）。
- 运行中的 Vite dev server 可 `GET /src/components/DbDataView.tsx` 验证能编译（200）。
- 端到端：用 `smoketest`(postgres 192.168.102.160) 验证 `count_query` 与 offset 翻页。

## 已知限制

- MSSQL 已支持分页：`OFFSET … FETCH NEXT …`（需 SQL Server 2012+）。若原 SQL 自带 `TOP` 则按原样执行、不分页。
- Access 分页为「取到 `offset+limit` 行再应用侧切片」，深翻页会拉取较多行（小库可接受）。
- MSSQL 无 ORDER BY 时用 `ORDER BY (SELECT NULL)`，翻页顺序不保证稳定；建议 SQL 自带 ORDER BY。
- `COUNT(*)` 在大表上可能较慢；后端已做失败降级（`total=null`），前端降级为“上一页/下一页”。

## Oracle 支持（driver = "oracle"）

- 依赖：`oracledb`（python-oracledb，**thin 模式**，无需 Oracle Instant Client）；已加入 `pyproject.toml` 与 PyInstaller spec 的 `hiddenimports`。
- 连接串（`db.build_url`）：
  - 服务名（默认）：`oracle+oracledb://user:pwd@host:1521/?service_name=<database>`。
  - SID：`oracle+oracledb://user:pwd@host:1521/<database>`（表单 `connectBy="sid"`）。
- 连接超时：`connect_args={"tcp_connect_timeout": 15}`。
- 方言：`_DIALECT["oracle"] = "oracle"`（供 sqlglot 授权检查 / 自带 LIMIT 判断）。
- 分页（`_page_sql`，按 `server_version_info` 自适应，返回 `(sql, drop_leading, drop_trailing)`）：
  - Oracle 12c+：`SELECT * FROM (<sql>) sub OFFSET m ROWS FETCH NEXT n ROWS ONLY`（表别名不能带 `AS`，也不能以 `_` 开头）。
  - Oracle 11g 及更早：`ROWNUM` 双层包装，末尾多出的 `rnum` 列由调用方丢弃（`drop_trailing=1`）。
- `count_query`：Oracle 用不带 `AS` 的别名（`_wrap_subquery` → `(...) sub`），否则报 `ORA-00933`。
- 连通性探测：Oracle 用 `SELECT 1 FROM dual`（`_probe_query`），否则 `ORA-00923`。
- **反射**：
  - `_engine` 对 Oracle 传 `exclude_tablespaces=[]`——SQLAlchemy 的 Oracle 方言**默认排除 `SYSTEM`/`SYSAUX` 表空间**，会导致以 SYSTEM/SYS 连接时反射出 **0 张表**。
  - `_reflect_name`：SQLAlchemy 把 Oracle 反射名**小写化**，需还原为真实名（未加引号时为大写），否则前端 `"customers"` 引号引用会 `ORA-00942`。
  - `_suppress_sa_warnings`：忽略反射未知列类型（Oracle `LONG RAW`/`ANYDATA`）的 SAWarning。
- 前端：`DatabaseForm` 增 `oracle` 选项 + 「连接方式（服务名 / SID）」选择器（仅 `driver === 'oracle'` 显示）；`DbDataView.quoteIdent` 用双引号。
- 边界：thin 模式最低要求 Oracle 12.1；11g 需 thick 模式 + Instant Client（暂未提供开关）。

## 实现顺序

1. 后端 `run_query`(+offset/hasMore) 与 `count_query` + 单测（红→绿）。
2. 后端路由 `/db/connections/{id}/query` + API 单测（红→绿）。
3. shared 类型 `DbQueryResult`。
4. `lib/api.ts` `runDbQuery`。
5. `store/ui.ts` `DbDataTab` + `openDbData`。
6. `DbDataView.tsx` 组件。
7. `DbSchemaView.tsx` 预览按钮。
8. `RightArea.tsx` 接线。
9. 文案 + 样式。
10. 验证：后端 pytest、renderer tsc、Vite 编译。

## 涉及文件清单

- 改：`services/agent/src/fireeyeaud_agent/store/db_engine.py`
- 改：`services/agent/src/fireeyeaud_agent/api/db.py`
- 增：`services/agent/tests/test_db_query_api.py`
- 改：`packages/shared/src/types.ts`
- 改：`packages/shared/src/locales/zh-CN.ts`、`en-US.ts`
- 改：`apps/renderer/src/lib/api.ts`
- 改：`apps/renderer/src/store/ui.ts`
- 改：`apps/renderer/src/components/RightArea.tsx`
- 增：`apps/renderer/src/components/DbDataView.tsx`
- 改：`apps/renderer/src/components/DbSchemaView.tsx`
- 改：`apps/renderer/src/styles/global.css`
