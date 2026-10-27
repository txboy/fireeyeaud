/** 杂项：关系图、工作底稿、导出、应用设置。 */

import type {
  AppSettings,
  GraphData,
  WorkingPaperFormat,
  WorkingPaperManifest,
} from '@fireeyeaud/shared';
import { request } from './client';

export function getGraph(findingId?: string): Promise<GraphData> {
  const qs = findingId ? `?findingId=${encodeURIComponent(findingId)}` : '';
  return request<GraphData>(`/graph${qs}`);
}

export function listWorkingPapers(): Promise<{ items: WorkingPaperManifest[] }> {
  return request<{ items: WorkingPaperManifest[] }>('/export/working-paper');
}

export interface ExportInput {
  format: WorkingPaperFormat;
  locale?: string;
  findingIds?: string[];
}

export function exportWorkingPaper(input: ExportInput): Promise<WorkingPaperManifest> {
  return request<WorkingPaperManifest>('/export/working-paper', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getSettings(): Promise<AppSettings> {
  return request<AppSettings>('/settings');
}

export interface SettingsPatch {
  locale?: string;
  theme?: string;
  systemPrompt?: string;
  webSearch?: {
    enabled?: boolean;
    provider?: string;
    keyRef?: string | null;
    baseUrl?: string | null;
  };
  skills?: {
    mode?: string;
  };
  archive?: {
    authorName?: string;
    authorEmail?: string;
  };
}
