/** 项目归档（Git）。 */

import type {
  AppSettings,
  ArchiveConfig,
  ArchiveConflictCheck,
  ArchiveHistoryItem,
  ArchiveStatus,
} from '@fireeyeaud/shared';
import { request } from './client';
import type { SettingsPatch } from './misc';

export function getArchiveStatus(): Promise<ArchiveStatus> {
  return request<ArchiveStatus>('/archive/status');
}

export function initArchive(): Promise<{ initialized: boolean }> {
  return request<{ initialized: boolean }>('/archive/init', { method: 'POST' });
}

export function commitArchive(message?: string): Promise<{
  id: string;
  tag: string;
  commit: string;
}> {
  return request('/archive/commit', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export function listArchiveHistory(): Promise<{ items: ArchiveHistoryItem[] }> {
  return request<{ items: ArchiveHistoryItem[] }>('/archive/history');
}

export function getArchiveChanges(
  id: string,
): Promise<{ items: Array<{ path: string; status: string }> }> {
  return request<{ items: Array<{ path: string; status: string }> }>(
    `/archive/${id}/changes`,
  );
}

export function setArchiveRemote(input: {
  url: string;
  username: string;
  credRef: string | null;
  autoPush: boolean;
}): Promise<ArchiveConfig> {
  return request<ArchiveConfig>('/archive/remote', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function pushArchive(archiveId?: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/archive/push', {
    method: 'POST',
    body: JSON.stringify({ archiveId }),
  });
}

export function checkArchiveConflict(): Promise<ArchiveConflictCheck> {
  return request<ArchiveConflictCheck>('/archive/conflict/check', {
    method: 'POST',
  });
}

export function resolveArchiveConflict(input: {
  base: 'local' | 'remote';
  choices: Record<string, 'local' | 'remote' | 'both' | 'auto'>;
  message: string;
  authorName?: string;
  authorEmail?: string;
}): Promise<{ id: string; tag: string; commit: string }> {
  return request('/archive/conflict/resolve', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cloneArchive(input: {
  url: string;
  targetDir: string;
  username?: string;
  credRef?: string | null;
}): Promise<{ target: string; warnings: string[] }> {
  return request<{ target: string; warnings: string[] }>('/archive/clone', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function restoreArchive(input: {
  archiveId: string;
  targetDir: string;
}): Promise<{ target: string; warnings: string[] }> {
  return request<{ target: string; warnings: string[] }>('/archive/restore', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function patchSettings(patch: SettingsPatch): Promise<AppSettings> {
  return request<AppSettings>('/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
