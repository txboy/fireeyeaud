/** 知识库 Provider：CRUD、试检索、启用集。 */

import type {
  ConfigScope,
  KbEnabledEntry,
  KbKnowledge,
  KbProvider,
  KbProviderDefaults,
  KbProviderType,
  KbQueryResult,
} from '@fireeyeaud/shared';
import { request } from './client';

export interface KbProvidersPage {
  items: KbProvider[];
  nextCursor: string | null;
}

export function listKbProviders(scope?: ConfigScope): Promise<KbProvidersPage> {
  return request<KbProvidersPage>(`/kb/providers${scope ? `?scope=${scope}` : ''}`);
}

export interface KbProviderInput {
  type: KbProviderType;
  name: string;
  baseUrl: string;
  scope: ConfigScope;
  apiKeyRef?: string | null;
  defaults?: KbProviderDefaults;
  isDefault?: boolean;
}

export function createKbProvider(input: KbProviderInput): Promise<KbProvider> {
  return request<KbProvider>('/kb/providers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateKbProvider(
  id: string,
  scope: ConfigScope,
  patch: Partial<KbProviderInput>,
): Promise<KbProvider> {
  return request<KbProvider>(`/kb/providers/${id}?scope=${scope}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteKbProvider(id: string, scope: ConfigScope): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/kb/providers/${id}?scope=${scope}`, {
    method: 'DELETE',
  });
}

export function testKbProvider(
  id: string,
  scope: ConfigScope,
): Promise<{ ok: boolean; knowledgeCount: number }> {
  return request(`/kb/providers/${id}/test?scope=${scope}`, { method: 'POST' });
}

/** 按表单当前填写值试连（不落盘）；给了 id 时 key 缺省回退已保存凭据。 */
export interface KbTestInput {
  type: KbProviderType;
  baseUrl: string;
  apiKey?: string | null;
  id?: string;
  scope?: ConfigScope;
}

export function testKbParams(
  input: KbTestInput,
): Promise<{ ok: boolean; knowledgeCount: number }> {
  return request('/kb/test', { method: 'POST', body: JSON.stringify(input) });
}

export function listKbKnowledge(
  id: string,
  scope: ConfigScope,
): Promise<{ items: KbKnowledge[] }> {
  return request(`/kb/providers/${id}/knowledge?scope=${scope}`);
}

export function listKbEnabled(scope?: ConfigScope): Promise<{ items: KbEnabledEntry[] }> {
  return request(`/kb/enabled${scope ? `?scope=${scope}` : ''}`);
}

export function setKbEnabled(
  scope: ConfigScope,
  items: KbEnabledEntry[],
): Promise<{ ok: boolean; items: KbEnabledEntry[] }> {
  return request('/kb/enabled', {
    method: 'PATCH',
    body: JSON.stringify({ scope, items }),
  });
}

export interface KbQueryInput {
  query: string;
  scope?: ConfigScope;
  knowledgeIds?: string[];
  topK?: number;
}

export function queryKbProvider(
  id: string,
  input: KbQueryInput,
): Promise<KbQueryResult> {
  return request<KbQueryResult>(`/kb/providers/${id}/query`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
