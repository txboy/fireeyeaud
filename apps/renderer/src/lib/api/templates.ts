/** 模板中心：全局 / 本项目 docx 模板。 */

import type {
  ConfigScope,
  FsFileContent,
  TemplateInfo,
  TemplateKind,
} from '@fireeyeaud/shared';
import { request } from './client';

export function listTemplates(
  kind?: TemplateKind,
  scope?: ConfigScope,
): Promise<{ items: TemplateInfo[] }> {
  const params = new URLSearchParams();
  if (kind) params.set('kind', kind);
  if (scope) params.set('scope', scope);
  const query = params.toString();
  return request(`/templates${query ? `?${query}` : ''}`);
}

export function uploadTemplates(
  kind: TemplateKind,
  paths: string[],
  scope: ConfigScope,
  isDefault = false,
  name?: string,
): Promise<{ items: TemplateInfo[] }> {
  return request('/templates', {
    method: 'POST',
    body: JSON.stringify({ kind, paths, scope, isDefault, name }),
  });
}

export function patchTemplate(
  id: string,
  scope: ConfigScope,
  patch: { name?: string; isDefault?: boolean; scope?: ConfigScope },
): Promise<TemplateInfo> {
  return request<TemplateInfo>(`/templates/${id}?scope=${scope}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteTemplateApi(
  id: string,
  scope: ConfigScope,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/templates/${id}?scope=${scope}`, {
    method: 'DELETE',
  });
}

/** 重新上传覆盖已有模板文件（保留 id / 名称 / 作用域 / 默认）。 */
export function replaceTemplateFile(
  id: string,
  scope: ConfigScope,
  path: string,
): Promise<TemplateInfo> {
  return request<TemplateInfo>(`/templates/${id}/replace?scope=${scope}`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function duplicateTemplateApi(
  id: string,
  scope: ConfigScope,
  targetScope: ConfigScope,
): Promise<TemplateInfo> {
  return request<TemplateInfo>(`/templates/${id}/duplicate?scope=${scope}`, {
    method: 'POST',
    body: JSON.stringify({ scope: targetScope }),
  });
}

/** 全局模板在项目目录外，必须走后端内容接口（不能读 fs:read-file）。 */
export function getTemplateContent(
  id: string,
  scope: ConfigScope,
): Promise<FsFileContent> {
  return request<FsFileContent>(`/templates/${id}/content?scope=${scope}`);
}

/** 新增模板时的本地文件检查 + 预览（只读，不保存）。 */
export interface TemplateInspectResult {
  ok: true;
  kind: 'base64';
  data: string;
  mime: string;
  size: number;
  path: string;
  name: string;
  fileName: string;
}

export function inspectTemplateFile(
  path: string,
  kind: TemplateKind,
): Promise<TemplateInspectResult> {
  return request<TemplateInspectResult>('/templates/inspect', {
    method: 'POST',
    body: JSON.stringify({ path, kind }),
  });
}
