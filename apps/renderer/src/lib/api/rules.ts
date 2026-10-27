/** 审计规则：CRUD 与试跑。 */

import type { AuditRule, ConfigScope, RuleRunResult } from '@fireeyeaud/shared';
import { request } from './client';

export interface RulesPage {
  items: AuditRule[];
  nextCursor: string | null;
}

export function listRules(): Promise<RulesPage> {
  return request<RulesPage>('/rules');
}

export interface RuleInput {
  name?: string;
  description?: string;
  sql?: string;
  databaseId?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
  scope?: ConfigScope;
}

export function createRule(input: RuleInput): Promise<AuditRule> {
  return request<AuditRule>('/rules', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateRuleApi(
  id: string,
  scope: ConfigScope,
  patch: RuleInput,
): Promise<AuditRule> {
  return request<AuditRule>(`/rules/${id}?scope=${scope}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteRuleApi(id: string, scope: ConfigScope): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/rules/${id}?scope=${scope}`, { method: 'DELETE' });
}

export interface RuleRunInput {
  sql?: string;
  sourceId?: string;
}

export function runRuleApi(id: string, input: RuleRunInput = {}): Promise<RuleRunResult> {
  return request<RuleRunResult>(`/rules/${id}/run`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
