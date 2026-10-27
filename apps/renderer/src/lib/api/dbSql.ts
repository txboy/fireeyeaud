/** SQL 助手：自然语言生成只读 SQL。 */

import type { ConfigScope, DbDriver } from '@fireeyeaud/shared';
import { safeFetch, apiBaseUrl, apiHeaders } from './client';
import { consumeSseGeneric } from './sse';

export interface DbSqlChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DbSqlSseEvent {
  type: 'status' | 'token' | 'done' | 'error' | 'tool_call' | 'tool_result';
  seq: number;
  ts: string;
  data: {
    phase?: string;
    delta?: string;
    messageKey?: string;
    code?: string;
    params?: Record<string, unknown>;
    usage?: Record<string, unknown>;
    /** tool_call / tool_result。 */
    callId?: string;
    tool?: string;
    ok?: boolean;
    summary?: string;
    reason?: string;
    rows?: number;
    columnsCount?: number;
  };
}

/** 表 / 列结构（只含模型判断所需信息，不含凭据与连接串）。 */
export interface DbSqlColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  comment?: string | null;
}

export interface DbSqlTableInfo {
  name: string;
  /** 超预算时会被裁掉，只剩表名。 */
  columns?: DbSqlColumnInfo[];
  /** 列已按上限裁剪。 */
  truncated?: boolean;
}

/** 发给 SQL 助手的上下文；构造见 `lib/dbSqlContext.ts`。 */
export interface DbSqlChatContext {
  connection: {
    id: string;
    name: string;
    driver: DbDriver;
    database: string | null;
  };
  table: { name: string; columns: DbSqlColumnInfo[] };
  tables: DbSqlTableInfo[];
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

export interface DbSqlChatHandlers {
  onEvent: (event: DbSqlSseEvent) => void;
  signal?: AbortSignal;
}

/** 请求 SQL 助手流式生成；结果由 SSE 事件回调（不落库、不写入会话）。 */
export async function streamDbSqlChat(
  input: DbSqlChatInput,
  { onEvent, signal }: DbSqlChatHandlers,
): Promise<void> {
  const res = await safeFetch(`${apiBaseUrl()}/db/sql-chat`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(input),
    signal,
  });
  await consumeSseGeneric<DbSqlSseEvent>(res, onEvent);
}
