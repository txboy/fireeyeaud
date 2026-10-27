/** 取证单写作台。 */

import type {
  ConfigScope,
  EvidenceFormBody,
  EvidenceFormDocument,
  EvidenceFormManifest,
  ReportBlock,
  ReportChatEntry,
  ReportSection,
  ReportVerifyResult,
} from '@fireeyeaud/shared';
import { request } from './client';
import type { ReportStreamEvent } from './reports';
import { streamDocChat } from './reports';

export interface CreateFormDraftInput {
  templateId: string;
  templateScope: ConfigScope;
  findingIds: string[];
  header?: Record<string, string>;
  title?: string;
}

export function createFormDraft(input: CreateFormDraftInput): Promise<EvidenceFormDocument> {
  return request<EvidenceFormDocument>('/evidence-forms/drafts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getFormDocument(id: string): Promise<EvidenceFormDocument> {
  return request<EvidenceFormDocument>(`/evidence-forms/${id}/doc`);
}

export function setFormOutline(
  id: string,
  sections: Array<{ id?: string; title: string; level?: number; goal?: string }>,
  approved: boolean,
): Promise<EvidenceFormBody> {
  return request<EvidenceFormBody>(`/evidence-forms/${id}/outline`, {
    method: 'PUT',
    body: JSON.stringify({ sections, approved }),
  });
}

export function writeFormSection(
  id: string,
  sectionId: string,
  blocks: ReportBlock[],
): Promise<ReportSection> {
  return request<ReportSection>(`/evidence-forms/${id}/sections/${sectionId}`, {
    method: 'PUT',
    body: JSON.stringify({ blocks }),
  });
}

export function setFormTitle(id: string, title: string): Promise<EvidenceFormBody> {
  return request<EvidenceFormBody>(`/evidence-forms/${id}/title`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  });
}

export function setFormFindings(id: string, findingIds: string[]): Promise<EvidenceFormBody> {
  return request<EvidenceFormBody>(`/evidence-forms/${id}/findings`, {
    method: 'PUT',
    body: JSON.stringify({ findingIds }),
  });
}

export function verifyFormDocument(id: string): Promise<ReportVerifyResult> {
  return request<ReportVerifyResult>(`/evidence-forms/${id}/verify`, { method: 'POST' });
}

export function exportFormDocument(
  id: string,
  title?: string,
): Promise<EvidenceFormManifest> {
  return request<EvidenceFormManifest>(`/evidence-forms/${id}/export`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export function listFormMessages(id: string): Promise<{ items: ReportChatEntry[] }> {
  return request<{ items: ReportChatEntry[] }>(`/evidence-forms/${id}/messages`);
}

/** 取证单写作对话流：POST + SSE，逐事件回调。 */
export async function streamFormChat(
  id: string,
  input: { message: string; locale?: string; modelId?: string },
  onEvent: (event: ReportStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await streamDocChat(`/evidence-forms/${id}/chat`, input, onEvent, signal);
}

export function listEvidenceForms(): Promise<{ items: EvidenceFormManifest[] }> {
  return request<{ items: EvidenceFormManifest[] }>('/evidence-forms');
}

export function deleteEvidenceForm(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/evidence-forms/${id}`, { method: 'DELETE' });
}

export function attachReceipt(
  id: string,
  path: string,
  note?: string,
): Promise<EvidenceFormManifest> {
  return request<EvidenceFormManifest>(`/evidence-forms/${id}/receipt`, {
    method: 'POST',
    body: JSON.stringify({ path, note }),
  });
}

export function clearReceipt(id: string): Promise<EvidenceFormManifest> {
  return request<EvidenceFormManifest>(`/evidence-forms/${id}/receipt`, {
    method: 'DELETE',
  });
}
