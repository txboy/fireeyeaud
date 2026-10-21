import type { DbSqlChatMessage } from './api';

/** 历史消息上限（与后端保持一致：最近 20 条 / 总计 40KB）。 */
const HISTORY_LIMIT = 20;
const HISTORY_CHARS = 40_000;

/**
 * 组装本轮请求的消息列表：历史 + 新的用户消息。
 *
 * 重要：预算与条数上限必须把**新消息**算进去（它属于「最近 20 条」的一部分），
 * 并保证裁剪后首条是 user —— 对话以 assistant 开头会被严格的 chat API 拒绝。
 */
export function buildSqlChatHistory(
  history: DbSqlChatMessage[],
  next: string,
): DbSqlChatMessage[] {
  const all: DbSqlChatMessage[] = [
    ...history.filter((m) => m.content.trim().length > 0),
    { role: 'user', content: next },
  ];

  // 先保证对话以 user 开头（严格 chat API 拒绝 assistant 开头），再按条数/预算裁剪，
  // 这样「最近 20 条」不会因为丢弃开头而少一条。
  const start = all.findIndex((m) => m.role === 'user');
  const ordered = start > 0 ? all.slice(start) : all;
  const tail = ordered.slice(-HISTORY_LIMIT);

  // 从最新往回收，总字符数不超预算
  const kept: DbSqlChatMessage[] = [];
  let total = 0;
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    total += tail[i].content.length;
    if (total > HISTORY_CHARS) break;
    kept.unshift(tail[i]);
  }

  while (kept.length > 0 && kept[0].role !== 'user') kept.shift();
  return kept;
}