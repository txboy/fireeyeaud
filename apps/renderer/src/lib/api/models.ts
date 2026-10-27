/** 模型配置：CRUD 与连通性测试。 */

import type { ConfigScope, ModelProfile } from '@fireeyeaud/shared';
import { request } from './client';

export interface ModelsPage {
  items: ModelProfile[];
  nextCursor: string | null;
}

export function listModels(scope?: ConfigScope): Promise<ModelsPage> {
  return request<ModelsPage>(`/models${scope ? `?scope=${scope}` : ''}`);
}

export interface ModelInput {
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  apiKeyRef?: string | null;
  isDefault?: boolean;
  vision?: boolean;
  scope: ConfigScope;
}

export function createModel(input: ModelInput): Promise<ModelProfile> {
  return request<ModelProfile>('/models', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateModel(
  id: string,
  scope: ConfigScope,
  patch: Partial<ModelInput>,
): Promise<ModelProfile> {
  return request<ModelProfile>(`/models/${id}?scope=${scope}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteModelApi(id: string, scope: ConfigScope): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/models/${id}?scope=${scope}`, {
    method: 'DELETE',
  });
}

export function testModel(id: string, scope: ConfigScope): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/models/${id}/test?scope=${scope}`, {
    method: 'POST',
  });
}

/** 按表单当前填写值试连（不落盘）。 */
export function testModelParams(input: {
  baseUrl?: string;
  model?: string;
}): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/models/test', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
