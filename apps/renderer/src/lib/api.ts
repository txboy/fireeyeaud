import type {
  ApiErrorEnvelope,
  Finding,
  SseEvent,
  WorkspaceInfo,
} from '@fireeyeaud/shared';
import { useSidecarStore } from '../store/sidecar';

export class ApiError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
    public messageKey: string,
    public params: Record<string, unknown> = {},
  ) {
    super(messageKey);
    this.name = 'ApiError';
  }
}

function baseUrl(): string {
  const info = useSidecarStore.getState().info;
  if (!info || !info.port) {
    throw new ApiError('E_SIDECAR_NOT_READY', 503, 'error.sidecarNotReady');
  }
  return `http://127.0.0.1:${info.port}/api/v1`;
}

function authHeaders(): Record<string, string> {
  const info = useSidecarStore.getState().info;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (info?.token) headers.Authorization = `Bearer ${info.token}`;
  return headers;
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const env = (await res.json()) as ApiErrorEnvelope;
    if (env?.error) {
      return new ApiError(
        env.error.code,
        res.status,
        env.error.messageKey,
        env.error.params ?? {},
      );
    }
  } catch {
    /* 非 JSON 响应 */
  }
  return new ApiError('E_INTERNAL', res.status, 'error.internal');
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(baseUrl() + path, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export function openWorkspaceApi(path: string): Promise<WorkspaceInfo> {
  return request<WorkspaceInfo>('/workspaces/open', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function closeWorkspaceApi(): Promise<{ closed: boolean }> {
  return request<{ closed: boolean }>('/workspaces/close', { method: 'POST' });
}

export interface SessionInfo {
  id: string;
  title: string | null;
  createdAt: string;
}

export function createSessionApi(input: {
  title?: string;
  dataSourceIds?: string[];
}): Promise<SessionInfo> {
  return request<SessionInfo>('/sessions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface ChatHandlers {
  onEvent: (event: SseEvent) => void;
  signal?: AbortSignal;
}

/** 发送一条消息并逐条回调 SSE 事件（POST + ReadableStream 解析）。 */
export async function streamChat(
  sessionId: string,
  message: string,
  { onEvent, signal }: ChatHandlers,
  locale?: string,
): Promise<void> {
  const res = await fetch(`${baseUrl()}/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ message, locale }),
    signal,
  });
  if (!res.ok || !res.body) throw await toApiError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (block: string) => {
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload) as SseEvent);
      } catch {
        /* 忽略无法解析的行 */
      }
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      dispatch(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  if (buffer.trim()) dispatch(buffer);
}

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
