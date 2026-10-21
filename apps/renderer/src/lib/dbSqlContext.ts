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
/** 预算紧张时，前 N 张相关表的列始终保留（其余先丢列）。 */
const KEEP_RELATED_COLUMN_TABLES = 5;
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

/** 单复数归一（够用即可：关系型表名大多只差一个 s/es）。 */
function singular(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('ies')) return lower.slice(0, -3) + 'y';
  if (lower.endsWith('es')) return lower.slice(0, -2);
  if (lower.endsWith('s')) return lower.slice(0, -1);
  return lower;
}

/** 判断 `<x>_id` 中的 x 是否指向另一张表。 */
function refersTo(stem: string, table: string): boolean {
  const s = singular(stem);
  const t = singular(table);
  return s === t || t.startsWith(s) || s.startsWith(t);
}

/**
 * 相关度打分（A）：用于在表很多 / 预算紧张时优先保留真正能 JOIN 的表。
 *
 * 权重：`<当前表>_id` 形式的外键 > 表名前缀/包含 > 反向外键（当前表有 `<他表>_id`）
 * > 列名交集。分数只用于排序，不影响正确性。
 */
export function scoreRelatedTable(
  current: DbTableSchema,
  candidate: DbTableSchema,
): number {
  if (candidate.table === current.table) return Number.POSITIVE_INFINITY;

  const currentName = current.table.toLowerCase();
  const candidateName = candidate.table.toLowerCase();
  let score = 0;

  // 表名关系
  if (candidateName.startsWith(`${currentName}_`) || candidateName.startsWith(`${currentName}`)) {
    score += 40;
  } else if (currentName.startsWith(`${candidateName}_`) || currentName.startsWith(candidateName)) {
    score += 20;
  }

  // 候选表持有指向当前表的外键
  for (const column of candidate.columns ?? []) {
    const match = /^(.+?)_id$/i.exec(column.name);
    if (match && refersTo(match[1], current.table)) score += 60;
  }

  // 当前表持有指向候选表的外键（反向）
  for (const column of current.columns ?? []) {
    const match = /^(.+?)_id$/i.exec(column.name);
    if (match && refersTo(match[1], candidate.table)) score += 50;
  }

  // 列名交集（排除通用列）
  const generic = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);
  const currentCols = new Set(
    (current.columns ?? [])
      .map((c) => c.name.toLowerCase())
      .filter((n) => !generic.has(n)),
  );
  let overlap = 0;
  for (const column of candidate.columns ?? []) {
    if (currentCols.has(column.name.toLowerCase())) overlap += 1;
  }
  score += Math.min(20, overlap * 4);

  return score;
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
  // A：按相关度排序，保证能 JOIN 的表先占名额（稳定排序，同分保持原顺序）
  const ranked = tables
    .filter((table) => !seen.has(table.table) && (seen.add(table.table), true))
    .map((table, index) => ({ table, index, score: scoreRelatedTable(current, table) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const others: DbSqlTableInfo[] = [];
  for (const { table } of ranked) {
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

  // 1) 从**最不相关**的表开始丢列（`tables` 已按相关度降序）；前 N 张相关表的列先保住。
  while (size() > MAX_CONTEXT_CHARS) {
    const victim = [...ctx.tables.slice(KEEP_RELATED_COLUMN_TABLES)]
      .reverse()
      .find((t) => (t.columns?.length ?? 0) > 0);
    if (!victim) break;
    victim.columns = [];
    victim.truncated = true;
    ctx.tablesTruncated = true;
  }
  if (size() <= MAX_CONTEXT_CHARS) return;

  // 2) 结果行从尾部减少
  if (ctx.result) {
    while (ctx.result.rows.length > 0 && size() > MAX_CONTEXT_CHARS) {
      const keep = Math.max(0, ctx.result.rows.length - Math.ceil(ctx.result.rows.length / 4));
      ctx.result.rows = ctx.result.rows.slice(0, keep);
      ctx.resultTruncated = true;
    }
  }
  if (size() <= MAX_CONTEXT_CHARS) return;

  // 3) 结果列从尾部减少
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

  // 4) 丢掉最不相关的表（只保留表名会重复第 1 步，这里直接移除）
  while (ctx.tables.length > 0 && size() > MAX_CONTEXT_CHARS) {
    ctx.tables = ctx.tables.slice(0, -1);
    ctx.tablesTruncated = true;
  }
  if (size() <= MAX_CONTEXT_CHARS) return;

  // 5) 当前表自身就过大（典型是超长列注释）：先截断注释，再整段丢弃注释。
  //    列名与类型属于生成 SQL 的必需信息，始终保留。
  while (size() > MAX_CONTEXT_CHARS && ctx.table.columns.some((c) => c.comment)) {
    ctx.table.columns = ctx.table.columns.map((c) =>
      c.comment && c.comment.length > 80 ? { ...c, comment: `${c.comment.slice(0, 80)}…` } : c,
    );
    ctx.tablesTruncated = true;
    if (ctx.table.columns.every((c) => !c.comment || c.comment.length <= 81)) break;
  }
  while (size() > MAX_CONTEXT_CHARS && ctx.table.columns.some((c) => c.comment)) {
    ctx.table.columns = ctx.table.columns.map((c) => {
      if (!c.comment) return c;
      const { comment: _dropped, ...rest } = c;
      return rest;
    });
    ctx.tablesTruncated = true;
  }
}