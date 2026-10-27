/** 后端还没就绪时的等待策略（纯函数，便于单测）。 */

/** 哪些错误算「后端还没准备好」，值得自动重试而不是直接报错。 */
export function isTransientOpenError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === 'E_NETWORK' || code === 'E_SIDECAR_NOT_READY';
}

/** 第 `attempt` 次重试前等多久：1s 起步，封顶 2s，避免频繁空转。 */
export function retryDelayMs(attempt: number): number {
  return Math.min(1000 * Math.max(attempt, 1), 2000);
}