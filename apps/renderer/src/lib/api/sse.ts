/** SSE 消费工具：把 POST 返回的流按 `\n\n` 切块并逐条回调解析后的事件。 */

import { toApiError } from './client';

/**
 * 通用 SSE 解析：读取 ReadableStream 并按 `\n\n` 切块，逐条回调已解析的 JSON。
 * 非 2xx 统一抛 ApiError（保留 messageKey）。
 */
export async function consumeSseGeneric<T>(
  res: Response,
  onEvent: (event: T) => void,
): Promise<void> {
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
        onEvent(JSON.parse(payload) as T);
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