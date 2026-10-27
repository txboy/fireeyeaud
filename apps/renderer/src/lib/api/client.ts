/**
 * HTTP 内核：baseUrl / 鉴权头 / 错误封装 / fetch 包装。
 *
 * 这是 `lib/api/*` 各领域模块共用的最小底座，只依赖共享类型与 sidecar store。
 * 各领域模块（workspaces / sessions / findings / db …）从这里取 `request`，
 * 业务函数不再堆在同一个 1400 行的文件里。
 */

import type { ApiErrorEnvelope } from '@fireeyeaud/shared';
import { useSidecarStore } from '../../store/sidecar';

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

export async function toApiError(res: Response): Promise<ApiError> {
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

/**
 * fetch 包装：把网络层异常（连接被拒 / 超时等）统一为 ApiError，
 * 避免上层拿到缺少 messageKey 的原始错误。
 */
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // 连不上本地后端 ≠ 程序内部错误：独立文案，避免用户看到「发生内部错误」而以为数据坏了。
    throw new ApiError('E_NETWORK', 0, 'error.network');
  }
}

/** 基础地址（SSE 等需要自行拼 URL 的调用方使用）。 */
export function apiBaseUrl(): string {
  return baseUrl();
}

/** 默认请求头（含鉴权）。 */
export function apiHeaders(): Record<string, string> {
  return authHeaders();
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await safeFetch(baseUrl() + path, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}