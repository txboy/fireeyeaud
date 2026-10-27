/** 技能包：CRUD。 */

import type { ConfigScope, Skill } from '@fireeyeaud/shared';
import { request } from './client';

export function listSkills(): Promise<{ items: Skill[] }> {
  return request<{ items: Skill[] }>('/skills');
}

export interface SkillInput {
  name: string;
  prompt: string;
  description?: string;
  whenToUse?: string;
  eager?: boolean;
  toolIds?: string[];
  params?: Record<string, unknown>;
  enabled?: boolean;
  scope: ConfigScope;
  isDefault?: boolean;
}

export function createSkill(input: SkillInput): Promise<Skill> {
  return request<Skill>('/skills', { method: 'POST', body: JSON.stringify(input) });
}

export function updateSkill(
  id: string,
  scope: ConfigScope,
  patch: Partial<SkillInput>,
): Promise<Skill> {
  return request<Skill>(`/skills/${id}?scope=${scope}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteSkill(id: string, scope: ConfigScope): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/skills/${id}?scope=${scope}`, { method: 'DELETE' });
}
