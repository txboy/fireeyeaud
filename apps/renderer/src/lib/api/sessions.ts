/** 会话：列表、消息、重命名、上下文。 */

import { request } from './client';
import type { AttachmentRef, ChatContext, WorkspaceRef } from './chat';

export interface SessionInfo {
  id: string;
  title: string | null;
  createdAt: string;
}

export function createSessionApi(input: {
  title?: string | null;
  dataSourceIds?: string[];
}): Promise<SessionInfo> {
  return request<SessionInfo>('/sessions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface SessionSummary {
  id: string;
  title: string | null;
  createdAt: string;
  lastMessageAt?: string;
  /** 会话级勾选资源（重开会话后恢复）。 */
  context?: ChatContext | null;
  modelId?: string | null;
}

/** 上下文快照里的一项（id + 展示名）。 */
export interface ContextOptionItem {
  id: string;
  name: string;
}

/** 某条用户消息实际带给模型的勾选项（按模块分组；默认项不在此列）。 */
export interface ContextSnapshot {
  model: ContextOptionItem | null;
  database: ContextOptionItem[];
  knowledge: ContextOptionItem[];
  mcp: ContextOptionItem[];
  skills: ContextOptionItem[];
  rules: ContextOptionItem[];
}

export interface AttachmentText {
  name: string;
  text: string;
  source?: 'local' | 'vision';
  truncated?: boolean;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  seq: number;
  role: string;
  content:
    | {
        text?: string;
        options?: ContextSnapshot | null;
        attachments?: AttachmentRef[];
        attachmentTexts?: AttachmentText[];
        mentions?: WorkspaceRef[];
      }
    | string
    | null;
  ts: string;
}

export function listSessionsApi(): Promise<{ items: SessionSummary[] }> {
  return request<{ items: SessionSummary[] }>('/sessions');
}

export function getSessionMessagesApi(id: string): Promise<{ items: SessionMessage[] }> {
  return request<{ items: SessionMessage[] }>(`/sessions/${id}/messages`);
}

export function deleteSessionMessageApi(
  id: string,
  messageId: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/sessions/${id}/messages/${messageId}`, {
    method: 'DELETE',
  });
}

export function deleteSessionApi(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' });
}

export function renameSessionApi(id: string, title: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

/** 保存会话级上下文（勾选资源 + 模型），供重开会话后恢复。 */
export function updateSessionContextApi(
  id: string,
  input: { context: ChatContext; modelId: string | null },
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/sessions/${id}/context`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
