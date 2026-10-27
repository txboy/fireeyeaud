/** 数据库连接：CRUD、反射、授权、只读查询（含工作区 DuckDB 预览）。 */

import type {
  ConfigScope,
  DbConnection,
  DbDriver,
  DbQueryResult,
  DbTableSchema,
} from '@fireeyeaud/shared';
import { request } from './client';

export interface DbConnectionsPage {
  items: DbConnection[];
  nextCursor: string | null;
}

export function listDbConnections(scope?: ConfigScope): Promise<DbConnectionsPage> {
  return request<DbConnectionsPage>(`/db/connections${scope ? `?scope=${scope}` : ''}`);
}

export interface DbConnectionInput {
  name: string;
  driver: DbDriver;
  scope: ConfigScope;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  credRef?: string | null;
  path?: string | null;
  isDefault?: boolean;
  connectBy?: 'service' | 'sid' | null;
}

export function createDbConnection(input: DbConnectionInput): Promise<DbConnection> {
  return request<DbConnection>('/db/connections', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateDbConnection(
  id: string,
  scope: ConfigScope,
  patch: Partial<DbConnectionInput>,
): Promise<DbConnection> {
  return request<DbConnection>(`/db/connections/${id}?scope=${scope}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteDbConnection(
  id: string,
  scope: ConfigScope,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/db/connections/${id}?scope=${scope}`, {
    method: 'DELETE',
  });
}

export function testDbConnection(
  id: string,
  scope: ConfigScope,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/db/connections/${id}/test?scope=${scope}`, {
    method: 'POST',
  });
}

/** 按表单当前填写值试连（不落盘）；给了 id 时密码缺省回退已保存凭据。 */
export interface DbTestInput {
  driver: DbDriver;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  path?: string | null;
  password?: string | null;
  id?: string;
  scope?: ConfigScope;
  connectBy?: 'service' | 'sid' | null;
}

export function testDbParams(input: DbTestInput): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/db/test', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface ReflectResult {
  sourceId: string;
  tables: string[];
  schema: DbTableSchema[];
  authorization: Record<string, string[]>;
}

export function reflectDbConnection(
  id: string,
  scope: ConfigScope,
): Promise<ReflectResult> {
  return request<ReflectResult>(`/db/connections/${id}/reflect?scope=${scope}`, {
    method: 'POST',
  });
}

export function setDbAuthorization(
  id: string,
  tables: Record<string, string[]>,
): Promise<{ ok: boolean; tables: Record<string, string[]> }> {
  return request<{ ok: boolean; tables: Record<string, string[]> }>(
    `/db/connections/${id}/authorization`,
    { method: 'PATCH', body: JSON.stringify({ tables }) },
  );
}

export interface DbQueryInput {
  sql: string;
  limit?: number;
  offset?: number;
  includeTotal?: boolean;
}

export function runDbQuery(
  id: string,
  scope: ConfigScope,
  input: DbQueryInput,
): Promise<DbQueryResult> {
  return request<DbQueryResult>(`/db/connections/${id}/query?scope=${scope}`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 工作区 DuckDB（文件型数据源）里的表结构：默认 SQL 与字段补全用。 */
export function getWorkspaceTableSchema(table: string): Promise<DbTableSchema> {
  return request<DbTableSchema>(
    `/datasources/workspace-duckdb/tables/${encodeURIComponent(table)}`,
  );
}

/** 在工作区 DuckDB 上执行只读 SQL 并分页返回。 */
export function runWorkspaceQuery(input: DbQueryInput): Promise<DbQueryResult> {
  return request<DbQueryResult>('/datasources/workspace-duckdb/query', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface DbSqlDiagnostic {
  message: string;
  reason: string;
  token?: string;
  line: number;
  col: number;
  from: number;
  to: number;
}

export interface DbSqlValidation {
  ok: boolean;
  errors: DbSqlDiagnostic[];
}

/** 纯语法校验：后端只解析，不连接 / 查询数据库。 */
export function validateDbSql(
  driver: DbDriver,
  sql: string,
  signal?: AbortSignal,
): Promise<DbSqlValidation> {
  return request<DbSqlValidation>('/db/validate-sql', {
    method: 'POST',
    body: JSON.stringify({ driver, sql }),
    signal,
  });
}
