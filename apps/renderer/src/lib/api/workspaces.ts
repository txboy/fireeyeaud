/** 工作区：打开 / 关闭。 */

import type { WorkspaceInfo } from '@fireeyeaud/shared';
import { request } from './client';

export function openWorkspaceApi(path: string): Promise<WorkspaceInfo> {
  return request<WorkspaceInfo>('/workspaces/open', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function closeWorkspaceApi(): Promise<{ closed: boolean }> {
  return request<{ closed: boolean }>('/workspaces/close', { method: 'POST' });
}
