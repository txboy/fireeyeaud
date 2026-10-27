/** 报告工作台：结构化正文 + 对话。 */

import type {
  ArtifactPreview,
  ConfigScope,
  ReportBlock,
  ReportBody,
  ReportChatEntry,
  ReportDocument,
  ReportManifest,
  ReportSection,
  ReportVerifyResult,
} from '@fireeyeaud/shared';
import {
  request,
  safeFetch,
  apiBaseUrl,
  apiHeaders,
  toApiError,
  ApiError,
} from './client';
import { parseSseBuffer } from '../reportSse';

export interface GenerateReportInput {
  templateId: string;
  templateScope: ConfigScope;
  formIds: string[];
  header: Record<string, string>;
}

export function previewReport(input: GenerateReportInput): Promise<ArtifactPreview> {
  return request<ArtifactPreview>('/reports/preview', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function commitReport(token: string, title?: string): Promise<ReportManifest> {
  return request<ReportManifest>('/reports', {
    method: 'POST',
    body: JSON.stringify({ token, title }),
  });
}

export function listReports(): Promise<{ items: ReportManifest[] }> {
  return request<{ items: ReportManifest[] }>('/reports');
}

export function deleteReport(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/reports/${id}`, { method: 'DELETE' });
}

export interface CreateReportDraftInput {
  templateId: string;
  templateScope: ConfigScope;
  formIds: string[];
  header?: Record<string, string>;
  title?: string;
}

export function createReportDraft(
  input: CreateReportDraftInput,
): Promise<ReportDocument> {
  return request<ReportDocument>('/reports/drafts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getReportDocument(id: string): Promise<ReportDocument> {
  return request<ReportDocument>(`/reports/${id}/doc`);
}

export function setReportOutline(
  id: string,
  sections: Array<{ id?: string; title: string; level?: number; goal?: string }>,
  approved: boolean,
): Promise<ReportBody> {
  return request<ReportBody>(`/reports/${id}/outline`, {
    method: 'PUT',
    body: JSON.stringify({ sections, approved }),
  });
}

export function writeReportSection(
  id: string,
  sectionId: string,
  blocks: ReportBlock[],
): Promise<ReportSection> {
  return request<ReportSection>(`/reports/${id}/sections/${sectionId}`, {
    method: 'PUT',
    body: JSON.stringify({ blocks }),
  });
}

export function setReportTitleApi(id: string, title: string): Promise<ReportBody> {
  return request<ReportBody>(`/reports/${id}/title`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  });
}

export function setReportForms(id: string, formIds: string[]): Promise<ReportBody> {
  return request<ReportBody>(`/reports/${id}/forms`, {
    method: 'PUT',
    body: JSON.stringify({ formIds }),
  });
}

export function verifyReportDocument(id: string): Promise<ReportVerifyResult> {
  return request<ReportVerifyResult>(`/reports/${id}/verify`, { method: 'POST' });
}

export function exportReportDocument(
  id: string,
  title?: string,
): Promise<ReportManifest> {
  return request<ReportManifest>(`/reports/${id}/export`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export function listReportMessages(
  id: string,
): Promise<{ items: ReportChatEntry[] }> {
  return request<{ items: ReportChatEntry[] }>(`/reports/${id}/messages`);
}

export interface ReportStreamEvent {
  event: string;
  data: Record<string, unknown>;
}

/** 写作台对话流：POST + SSE，逐事件回调（报告与取证单共用）。 */
export async function streamDocChat(
  path: string,
  input: { message: string; locale?: string; modelId?: string },
  onEvent: (event: ReportStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await safeFetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok) throw await toApiError(res);
  if (!res.body) throw new ApiError('E_INTERNAL', res.status, 'error.internal');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) onEvent(event);
  }
  const tail = parseSseBuffer(buffer, true);
  for (const event of tail.events) onEvent(event);
}

/** 报告对话流：POST + SSE，逐事件回调。 */
export async function streamReportChat(
  id: string,
  input: { message: string; locale?: string; modelId?: string },
  onEvent: (event: ReportStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await streamDocChat(`/reports/${id}/chat`, input, onEvent, signal);
}
