/** 疑点与证据：人工疑点、审核、证据挂接。 */

import type { EvidenceItem, Finding } from '@fireeyeaud/shared';
import { request } from './client';

export interface FindingsPage {
  items: Finding[];
  nextCursor: string | null;
}

export function listFindings(params?: {
  severity?: string;
  status?: string;
  limit?: number;
}): Promise<FindingsPage> {
  const query = new URLSearchParams();
  if (params?.severity) query.set('severity', params.severity);
  if (params?.status) query.set('status', params.status);
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return request<FindingsPage>(`/findings${qs ? `?${qs}` : ''}`);
}

export function getFindingApi(id: string): Promise<Finding> {
  return request<Finding>(`/findings/${id}`);
}

export interface ReviewInput {
  action: string;
  reviewer?: string;
  comment?: string;
  note?: string;
  severity?: string;
  reason?: string;
}

export function reviewFindingApi(id: string, body: ReviewInput): Promise<unknown> {
  return request(`/findings/${id}/review`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function listEvidence(findingId?: string): Promise<{ items: EvidenceItem[] }> {
  const qs = findingId ? `?findingId=${encodeURIComponent(findingId)}` : '';
  return request<{ items: EvidenceItem[] }>(`/evidence${qs}`);
}

export interface CreateFindingInput {
  title: string;
  description?: string;
  severity: string;
  subjects?: string[];
  amount?: string;
  currency?: string;
  author?: string;
  lang?: string;
}

export function createFindingApi(input: CreateFindingInput): Promise<Finding> {
  return request<Finding>('/findings', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteFindingApi(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/findings/${id}`, { method: 'DELETE' });
}

export interface AddEvidenceInput {
  kind: 'file' | 'text' | 'record';
  title: string;
  note?: string;
  path?: string;
}

export function addFindingEvidenceApi(
  findingId: string,
  input: AddEvidenceInput,
): Promise<{ evidence: EvidenceItem; finding: Finding }> {
  return request<{ evidence: EvidenceItem; finding: Finding }>(
    `/findings/${findingId}/evidence`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function removeFindingEvidenceApi(
  findingId: string,
  evidenceId: string,
): Promise<{ ok: boolean; finding: Finding }> {
  return request<{ ok: boolean; finding: Finding }>(
    `/findings/${findingId}/evidence/${evidenceId}`,
    { method: 'DELETE' },
  );
}
