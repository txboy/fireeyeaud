/** 通用审计对话：SSE 流式；以及会话 / 数据源共用的上下文类型。 */

import type { SseEvent } from '@fireeyeaud/shared';
import { safeFetch, apiBaseUrl, apiHeaders } from './client';
import { consumeSseGeneric } from './sse';

export interface ChatHandlers {
  onEvent: (event: SseEvent) => void;
  signal?: AbortSignal;
}

/** 消费 POST 返回的 SSE 流并逐条回调事件。 */
export async function consumeSse(
  res: Response,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  await consumeSseGeneric<SseEvent>(res, onEvent);
}

/** 对话上下文：本次会话勾选的非默认资源（后端再并上默认集）。 */
export interface ChatContext {
  skillIds: string[];
  kbProviderIds: string[];
  dbConnectionIds: string[];
  mcpServerIds: string[];
  ruleIds: string[];
}

/** 临时附件（不写工作区，仅随消息提供给模型参考）。 */
export interface AttachmentRef {
  path: string;
  name: string;
  size?: number;
}

/** @ 引用的工作区条目（path 为工作区相对 POSIX 路径）。 */
export interface WorkspaceRef {
  path: string;
  name: string;
  isDir: boolean;
}

export const EMPTY_CONTEXT: ChatContext = {
  skillIds: [],
  kbProviderIds: [],
  dbConnectionIds: [],
  mcpServerIds: [],
  ruleIds: [],
};

/** 发送一条消息并逐条回调 SSE 事件（POST + ReadableStream 解析）。 */
export async function streamChat(
  sessionId: string,
  message: string,
  { onEvent, signal }: ChatHandlers,
  locale?: string,
  modelId?: string,
  context?: ChatContext,
  attachments?: AttachmentRef[],
  mentions?: WorkspaceRef[],
): Promise<void> {
  const res = await safeFetch(`${apiBaseUrl()}/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({
      message,
      locale,
      modelId,
      // 后端 ChatBody 期望扁平字段（与「保存会话上下文」接口不同）。
      ...(context ?? EMPTY_CONTEXT),
      attachments,
      mentions,
    }),
    signal,
  });
  await consumeSse(res, onEvent);
}
