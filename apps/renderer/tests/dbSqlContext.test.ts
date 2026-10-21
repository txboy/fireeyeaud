import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DbQueryResult, DbTableSchema } from '@fireeyeaud/shared';
import type { DbDataTab } from '../src/store/ui.ts';
import { buildDbSqlContext } from '../src/lib/dbSqlContext.ts';

const MAX_TABLES = 40;

function tab(overrides: Partial<DbDataTab> = {}): DbDataTab {
  return {
    id: 'dbData:c1:voucher',
    kind: 'dbData',
    connectionId: 'c1',
    scope: 'project',
    name: '本地',
    driver: 'sqlite',
    table: {
      table: 'voucher',
      columns: [
        { name: 'id', type: 'INTEGER', primaryKey: true, nullable: false },
        { name: '科目', type: 'TEXT', nullable: true },
      ],
    },
    ...overrides,
  } as DbDataTab;
}

function result(rows: unknown[][], columns = ['id', '科目']): DbQueryResult {
  return {
    columns,
    rows,
    rowCount: rows.length,
    total: rows.length,
    hasMore: false,
    paginated: true,
    limit: 50,
    offset: 0,
    sql: 'SELECT * FROM voucher',
  };
}

function bigTables(n: number, cols: number): DbTableSchema[] {
  return Array.from({ length: n }, (_, i) => ({
    table: `t${i}`,
    columns: Array.from({ length: cols }, (_, j) => ({
      name: `c${j}`,
      type: 'TEXT',
    })),
  }));
}

test('includes connection, table, current/executed sql and paging', () => {
  const ctx = buildDbSqlContext({
    tab: tab(),
    tables: [tab().table],
    currentSql: 'SELECT 1',
    executedSql: 'SELECT 2',
    result: result([[1, '现金']]),
    error: 'no such column',
    page: 3,
    pageSize: 50,
    total: 999,
  });

  assert.equal(ctx.connection.id, 'c1');
  assert.equal(ctx.connection.driver, 'sqlite');
  assert.equal(ctx.table.name, 'voucher');
  assert.deepEqual(
    ctx.table.columns.map((c) => c.name),
    ['id', '科目'],
  );
  assert.equal(ctx.currentSql, 'SELECT 1');
  assert.equal(ctx.executedSql, 'SELECT 2');
  assert.equal(ctx.error, 'no such column');
  assert.equal(ctx.page, 3);
  assert.equal(ctx.pageSize, 50);
  assert.equal(ctx.total, 999);
  assert.deepEqual(ctx.result, { columns: ['id', '科目'], rows: [[1, '现金']] });
  assert.equal(ctx.resultTruncated, false);
});

test('never emits credentials, host or connection string fields', () => {
  const leaky = tab() as DbDataTab & Record<string, unknown>;
  Object.assign(leaky, {
    host: '10.0.0.9',
    password: 'hunter2',
    credRef: 'cred-secret',
    username: 'admin',
    url: 'postgres://u:p@h/db',
  });
  const ctx = buildDbSqlContext({
    tab: leaky,
    tables: [tab().table],
    currentSql: 'SELECT 1',
    executedSql: null,
    result: null,
    error: null,
    page: 1,
    pageSize: 50,
    total: null,
  });
  const text = JSON.stringify(ctx);
  for (const secret of ['hunter2', 'cred-secret', '10.0.0.9', 'postgres://']) {
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  }
});

test('caps the current table at 80 columns and other tables at 40', () => {
  const cols = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `c${i}`, type: 'TEXT' }));
  const current = { table: 'voucher', columns: cols(120) };
  const ctx = buildDbSqlContext({
    tab: tab({ table: current }),
    tables: [current, { table: 'other', columns: cols(90) }],
    currentSql: '',
    executedSql: null,
    result: null,
    error: null,
    page: 1,
    pageSize: 50,
    total: null,
  });
  assert.equal(ctx.table.columns.length, 80);
  const other = ctx.tables.find((t) => t.name === 'other');
  assert.equal(other?.columns?.length, 40);
  assert.equal(ctx.tablesTruncated, true);
});

test('caps the number of tables at 40 but always keeps the current table', () => {
  const ctx = buildDbSqlContext({
    tab: tab(),
    tables: [{ table: 'zzz_not_in_list', columns: [] }, ...bigTables(60, 2)],
    currentSql: '',
    executedSql: null,
    result: null,
    error: null,
    page: 1,
    pageSize: 50,
    total: null,
  });
  // 当前表单独放在 `table`，不计入 `tables`
  assert.equal(ctx.table.name, 'voucher');
  assert.ok(ctx.tables.length <= MAX_TABLES, `too many tables: ${ctx.tables.length}`);
  assert.ok(!ctx.tables.some((t) => t.name === 'voucher'));
  assert.equal(ctx.tablesTruncated, true);
});

test('takes only the first 20 result rows and marks truncation', () => {
  const rows = Array.from({ length: 30 }, (_, i) => [i, `v${i}`]);
  const ctx = buildDbSqlContext({
    tab: tab(),
    tables: [],
    currentSql: '',
    executedSql: null,
    result: result(rows),
    error: null,
    page: 1,
    pageSize: 50,
    total: 30,
  });
  assert.equal(ctx.result?.rows.length, 20);
  assert.equal(ctx.resultTruncated, true);
});

test('caps result columns at 100 and truncates long cell strings with an ellipsis', () => {
  const columns = Array.from({ length: 120 }, (_, i) => `c${i}`);
  const rows = [Array.from({ length: 120 }, () => 'x'.repeat(900))];
  const ctx = buildDbSqlContext({
    tab: tab(),
    tables: [],
    currentSql: '',
    executedSql: null,
    result: result(rows, columns),
    error: null,
    page: 1,
    pageSize: 50,
    total: 1,
  });
  assert.equal(ctx.result?.columns.length, 100);
  assert.equal(ctx.result?.rows[0].length, 100);
  const cell = ctx.result?.rows[0][0] as string;
  assert.ok(cell.length <= 501, `cell too long: ${cell.length}`);
  assert.ok(cell.endsWith('…'));
  assert.equal(ctx.resultTruncated, true);
});

test('keeps the serialized context near the 60KB budget', () => {
  const columns = Array.from({ length: 100 }, (_, i) => `col${i}`);
  const rows = Array.from({ length: 20 }, () =>
    Array.from({ length: 100 }, () => 'y'.repeat(500)),
  );
  const ctx = buildDbSqlContext({
    tab: tab(),
    tables: bigTables(40, 40),
    currentSql: 'SELECT 1',
    executedSql: 'SELECT 1',
    result: result(rows, columns),
    error: null,
    page: 1,
    pageSize: 50,
    total: 1,
  });
  const size = JSON.stringify(ctx).length;
  assert.ok(size <= 60_000, `context too big: ${size}`);
  assert.equal(ctx.tablesTruncated, true);
});

test('drops result rows before touching the current table schema when over budget', () => {
  const rows = Array.from({ length: 20 }, () =>
    Array.from({ length: 100 }, () => 'z'.repeat(500)),
  );
  const ctx = buildDbSqlContext({
    tab: tab(),
    tables: bigTables(40, 40),
    currentSql: '',
    executedSql: null,
    result: result(rows),
    error: null,
    page: 1,
    pageSize: 50,
    total: 1,
  });
  // 当前表列永远优先保留
  assert.equal(ctx.table.columns.length, 2);
  // 相关表被裁成只剩表名
  assert.ok(ctx.tables.length > 0);
  assert.ok(ctx.tables.every((t) => (t.columns?.length ?? 0) === 0));
  assert.equal(ctx.tablesTruncated, true);
  assert.equal(ctx.resultTruncated, true);
  // 结果优先保留行、最后才砍列
  assert.ok(ctx.result !== null);
  assert.ok(JSON.stringify(ctx).length <= 60_000);
});

test('null result and null error are passed through', () => {
  const ctx = buildDbSqlContext({
    tab: tab(),
    tables: [],
    currentSql: '',
    executedSql: null,
    result: null,
    error: null,
    page: 1,
    pageSize: 50,
    total: null,
  });
  assert.equal(ctx.result, null);
  assert.equal(ctx.error, null);
  assert.equal(ctx.total, null);
  assert.equal(ctx.executedSql, null);
});