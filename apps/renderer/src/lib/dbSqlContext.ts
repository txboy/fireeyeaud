import type { DbQueryResult, DbTableSchema } from '@fireeyeaud/shared';
import type {
  DbSqlChatContext,
  DbSqlColumnInfo,
  DbSqlTableInfo,
} from './api';
import type { DbDataTab } from '../store/ui';

/** 上下文裁剪上限（与后端 sql_assistant.py 保持一致）。 */
const MAX_CURRENT_COLUMNS = 80;
const MAX_RELATED_COLUMNS = 40;
const MAX_TABLES = 40;
const MAX_RESULT_ROWS = 20;
const MAX_RESULT_COLS = 100;
const MAX_CELL_CHARS = 500;
const MAX_CONTEXT_CHARS = 60_000;
/** 单条 SQL / 错误文本上限：只裁结果压不住超长 SQL。 */
const MAX_SQL_CHARS = 8_000;
const MAX_ERROR_CHARS = 2_000;

/**
 * 结果列名同样是数据：名为 password / host / token 的列不发给模型。
 * 与后端 `sql_assistant._SECRET_KEYS` 保持一致（后端另有兜底）。
 */
const SECRET_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'credref',
  'secret',
  'apikey',
  'apikeyref',
  'token',
  'host',
  'port',
  'url',
  'connectionstring',
  'authorization',
  'username',
]);

function capText(value: string | null, limit: number): string | null {
  if (value == null) return null;
  return value.length > limit ? `${value.slice(0, limit)}\n-- …（已截断）` : value;
}

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

/** 只挑模型判断需要的字段：绝不带出密码、凭据引用、主机与连接串。 */
function toColumns(columns: DbTableSchema['columns']): DbSqlColumnInfo[] {
  return columns.map((c) => ({
    name: c.name,
    type: c.type,
    ...(c.nullable != null ? { nullable: c.nullable } : {}),
    ...(c.primaryKey ? { primaryKey: true } : {}),
    ...(c.comment ? { comment: c.comment } : {}),
  }));
}

function truncateCell(value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_CELL_CHARS) {
    return `${value.slice(0, MAX_CELL_CHARS)}…`;
  }
  return value;
}

function compactResult(
  result: DbQueryResult | null,
): { result: DbSqlChatContext['result']; truncated: boolean } {
  if (!result) return { result: null, truncated: false };

  let truncated = false;
  let columns = result.columns;
  if (columns.length > MAX_RESULT_COLS) {
    columns = columns.slice(0, MAX_RESULT_COLS);
    truncated = true;
  }
  let rows = result.rows;
  if (rows.length > MAX_RESULT_ROWS) {
    rows = rows.slice(0, MAX_RESULT_ROWS);
    truncated = true;
  }
  const trimmedRows = rows.map((row) => {
    const values = row.slice(0, MAX_RESULT_COLS);
    if (row.length > MAX_RESULT_COLS) truncated = true;
    return values.map(truncateCell);
  });

  // 敏感列名整体丢弃（列与对应单元格一起），否则「密码 / 主机」列会原样进入提示词。
  const keep = columns
    .map((name, index) => (SECRET_KEYS.has(String(name).toLowerCase()) ? -1 : index))
    .filter((index) => index >= 0);
  if (keep.length !== columns.length) {
    truncated = true;
    columns = keep.map((index) => columns[index]);
    rows = trimmedRows.map((row) => keep.map((index) => row[index] ?? null));
  } else {
    rows = trimmedRows;
  }

  return { result: { columns, rows }, truncated };
}

/** 当前表始终保留；其余表按上限截断，超出的丢弃。 */
function compactTables(
  current: DbTableSchema,
  tables: DbTableSchema[],
): { tables: DbSqlTableInfo[]; truncated: boolean } {
  let truncated = false;

  let currentColumns = toColumns(current.columns);
  let currentTruncated = false;
  if (currentColumns.length > MAX_CURRENT_COLUMNS) {
    currentColumns = currentColumns.slice(0, MAX_CURRENT_COLUMNS);
    currentTruncated = true;
    truncated = true;
  }
  const head: DbSqlTableInfo = {
    name: current.table,
    columns: currentColumns,
    ...(currentTruncated ? { truncated: true } : {}),
  };

  const seen = new Set([current.table]);
  const others: DbSqlTableInfo[] = [];
  for (const table of tables) {
    if (seen.has(table.table)) continue;
    seen.add(table.table);
    if (others.length >= MAX_TABLES - 1) {
      truncated = true;
      continue;
    }
    let columns = toColumns(table.columns);
    let wasTruncated = false;
    if (columns.length > MAX_RELATED_COLUMNS) {
      columns = columns.slice(0, MAX_RELATED_COLUMNS);
      wasTruncated = true;
      truncated = true;
    }
    others.push({
      name: table.table,
      columns,
      ...(wasTruncated ? { truncated: true } : {}),
    });
  }
  return { tables: [head, ...others], truncated };
}

/**
 * 组装 SQL 助手上下文：只含结构 / 当前查询 / 样本结果，
 * 按 60KB 预算依次裁剪（非当前表列 → 结果行 → 结果列 → 相关表）。
 */
export function buildDbSqlContext(input: DbSqlContextInput): DbSqlChatContext {
  const { tab } = input;
  const { result, truncated: resultTruncated } = compactResult(input.result);
  const { tables, truncated: tablesTruncated } = compactTables(tab.table, input.tables);

  const ctx: DbSqlChatContext = {
    connection: {
      id: tab.connectionId,
      name: tab.name,
      driver: tab.driver,
      database: null,
    },
    table: {
      name: tables[0].name,
      columns: tables[0].columns ?? [],
    },
    tables: tables.slice(1),
    tablesTruncated,
    currentSql: capText(input.currentSql, MAX_SQL_CHARS) ?? '',
    executedSql: capText(input.executedSql, MAX_SQL_CHARS),
    result,
    resultTruncated,
    error: capText(input.error, MAX_ERROR_CHARS),
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
  };

  fitBudget(ctx);
  return ctx;
}

/**
 * 按预算裁剪（原地修改）。顺序与计划一致：
 * 1) 丢弃非当前表结构（保留表名）2) 结果行从尾部减少
 * 3) 结果列从尾部减少 4) 其他表只保留表名/清空
 */
function fitBudget(ctx: DbSqlChatContext): void {
  const size = () => JSON.stringify(ctx).length;

  if (size() <= MAX_CONTEXT_CHARS) return;

  if (ctx.tables.length) {
    ctx.tables = ctx.tables.map((t) => ({ name: t.name }));
    ctx.tablesTruncated = true;
  }
  if (size() <= MAX_CONTEXT_CHARS) return;

  if (ctx.result) {
    while (ctx.result.rows.length > 0 && size() > MAX_CONTEXT_CHARS) {
      const keep = Math.max(0, ctx.result.rows.length - Math.ceil(ctx.result.rows.length / 4));
      ctx.result.rows = ctx.result.rows.slice(0, keep);
      ctx.resultTruncated = true;
    }
  }
  if (size() <= MAX_CONTEXT_CHARS) return;

  if (ctx.result) {
    while (ctx.result.columns.length > 0 && size() > MAX_CONTEXT_CHARS) {
      const keep = Math.max(
        0,
        ctx.result.columns.length - Math.ceil(ctx.result.columns.length / 4),
      );
      ctx.result = {
        columns: ctx.result.columns.slice(0, keep),
        rows: ctx.result.rows.map((row) => row.slice(0, keep)),
      };
      ctx.resultTruncated = true;
    }
  }
  if (size() <= MAX_CONTEXT_CHARS) return;

  if (ctx.tables.length) {
    ctx.tables = [];
    ctx.tablesTruncated = true;
  }
}