/** 数据源：列表、导入、对账。 */

import type { DataSourceInfo } from '@fireeyeaud/shared';
import { request, safeFetch, apiBaseUrl, apiHeaders } from './client';
import type { ChatHandlers } from './chat';
import { consumeSse } from './chat';

export interface DatasourcesPage {
  items: DataSourceInfo[];
  nextCursor: string | null;
}

export function listDatasources(): Promise<DatasourcesPage> {
  return request<DatasourcesPage>('/datasources');
}

/** 删除已导入的数据源（DuckDB 表 + 登记记录，不动磁盘原文件）。 */
export function deleteDataSource(id: string): Promise<{ ok: boolean; sourceId: string }> {
  return request(`/datasources/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 导入单个数据文件并回调 SSE 进度事件。 */
export async function importDataSource(
  path: string,
  { onEvent, signal }: ChatHandlers,
): Promise<void> {
  const res = await safeFetch(`${apiBaseUrl()}/datasources/import`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ path }),
    signal,
  });
  await consumeSse(res, onEvent);
}

export interface SyncResult {
  added: string[];
  removed: string[];
  updated: string[];
  errors: { path?: string; sourceId?: string; code: string }[];
}

/** 触发工作区数据源对账（新增导入 / 删除移除 / 修改替换），SSE 回推进度；返回对账结果。 */
export async function syncDatasources({
  onEvent,
  signal,
  full = false,
}: ChatHandlers & { full?: boolean }): Promise<SyncResult> {
  let result: SyncResult = { added: [], removed: [], updated: [], errors: [] };
  const res = await safeFetch(
    `${apiBaseUrl()}/datasources/sync${full ? '?full=true' : ''}`,
    {
      method: 'POST',
      headers: apiHeaders(),
      signal,
    },
  );
  await consumeSse(res, (event) => {
    if (event.type === 'done') {
      const data = (event.data ?? {}) as Partial<SyncResult>;
      result = {
        added: data.added ?? [],
        removed: data.removed ?? [],
        updated: data.updated ?? [],
        errors: data.errors ?? [],
      };
    }
    onEvent(event);
  });
  return result;
}
