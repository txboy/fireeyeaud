/** SSE 帧解析：按行解析，兼容 CRLF 在任意字节处被拆包。 */

export interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

export function parseSseBuffer(
  buffer: string,
  flush = false,
): { events: SseFrame[]; rest: string } {
  let text = buffer.replace(/\r\n/g, '\n');
  const frames: string[] = [];
  let index = text.indexOf('\n\n');
  while (index >= 0) {
    frames.push(text.slice(0, index));
    text = text.slice(index + 2);
    index = text.indexOf('\n\n');
  }
  if (flush) {
    if (text.trim()) frames.push(text);
    text = '';
  }

  const events: SseFrame[] = [];
  for (const frame of frames) {
    let name = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) continue;
    let data: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(dataLines.join('\n'));
      if (parsed && typeof parsed === 'object') {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      data = {};
    }
    events.push({ event: name, data });
  }
  return { events, rest: text };
}
