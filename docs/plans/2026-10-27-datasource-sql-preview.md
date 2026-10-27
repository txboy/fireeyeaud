# 文件型数据源的 SQL 预览（工作区 DuckDB）

## 背景

导入后的表格文件（`.csv` / `.xlsx` / `.xlsm`）会写进 `<工作区>/.fireeye/workspace.duckdb`
的 `src_*` 原始表。此前点这些数据源只能打开**磁盘上的原文件预览**，无法对导入后的表写 SQL；
而数据库型数据源已经有完整的 SQL 预览（编辑器、分页、总数、AI 生成 SQL）。

本次把工作区 DuckDB 接成一个**内置只读连接**，让文件型数据源复用同一套预览界面。

## 设计

- 连接 id：`workspace-duckdb`（`store/db.py::WORKSPACE_DUCKDB_ID`），指向
  `<工作区>/.fireeye/workspace.duckdb`，驱动名 `duckdb`。
- 内置连接**不进** `project.json` / 全局 `db.json`，也不出现在「数据库连接」面板；
  创建（`POST /db/connections`）与删除（`DELETE /db/connections/{id}`）都会被拒绝。
- 只读保证来自 SQL 沙箱（`sandbox.validate_sql`：仅 SELECT / WITH / EXPLAIN / DESCRIBE），
  而不是 DuckDB 的 `read_only=True`。原因：同一个数据库文件在同一进程内不能有不同配置的连接
  （会报 `Can't open a connection to same database file with a different configuration`），
  而导入 / 对账 / 规则都用默认读写连接。预览与写操作通过进程内锁串行化。
- 方言：`sqlglot` 按 PostgreSQL 解析（DuckDB 与 PG 接近）；分页统一 `LIMIT n+1 OFFSET m` 派生表。
- 只暴露 `src_*` 表，`workspace.duckdb` 里的内部表不开放。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/datasources/workspace-duckdb/tables/{table}` | 预览页需要的表结构（默认 SQL、字段补全、表头） |
| POST | `/datasources/workspace-duckdb/query` | 只读 SQL + 分页 + 可选总数，返回结构同 `/db/connections/{id}/query` |

`{table}` 必须以 `src_` 开头，否则 404（`E_NOT_FOUND`）。

## 界面

- 资源管理器点文件型数据源 → 右侧打开 `dbData` tab（来源 `workspace-duckdb`），
  默认 SQL 为 `SELECT * FROM "src_ds1_xxx"`。
- 不同文件可能都导入出 `sheet1` 这类同名表，tab 用数据源 id 做 key（`workspace:ds_1`），互不覆盖。
- 条目右侧新增「打开原始文件」图标，保留查看 Excel/CSV 原样的入口。
- 该预览页不提供 AI 生成 SQL（SQL 助手绑定数据库连接，工作区表没有对应连接）。

## 测试

- `services/agent/tests/test_duckdb_preview_api.py`：分页与总数、写操作被沙箱拦下、
  内部表被拒、表结构、内置连接不可删/不可建、方言。
- `apps/renderer/tests/workspaceDuckdbPreview.test.ts`：tab 打开/复用、同名表互不覆盖、
  普通连接仍走 `connection` 来源。

## 已知限制

`src_*` 表的所有列都是 `VARCHAR`（导入时按字符串落库），所以聚合金额需要显式 `CAST`，
例如 `SELECT SUM(CAST("金额" AS DECIMAL(18,2))) FROM "src_ds1_序时账"`。
导入时按 `schema.json` 的推断结果建强类型列是后续单独一项改动（会改变已有工作区的表结构，需重建数据源）。