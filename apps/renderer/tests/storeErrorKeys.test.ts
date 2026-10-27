import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * store 的失败路径：错误必须落成可翻译的 `error.xxx`，而不是让 errorKey 为空。
 * 直接调用 store 需要浏览器环境（侧栏 / localStorage），这里只验证「错误 → key」
 * 这条共享规则在 store 中使用的入口行为。
 */
import { errorKeyOf } from '../src/lib/errorKey.ts';

function apiError(messageKey: string): Error {
  const err = new Error(messageKey);
  err.name = 'ApiError';
  (err as unknown as { messageKey: string }).messageKey = messageKey;
  return err;
}

test('load 失败：保留后端 messageKey', () => {
  assert.equal(errorKeyOf(apiError('error.dbConn')), 'error.dbConn');
});

test('load 失败但无 messageKey：落到 internal 而不是空串', () => {
  const key = errorKeyOf(new Error('fetch failed'));
  assert.equal(key, 'error.internal');
  assert.ok(key.startsWith('error.'));
});

test('删除失败使用场景化兜底（deleteFailed）', () => {
  assert.equal(errorKeyOf(new TypeError('x'), 'error.deleteFailed'), 'error.deleteFailed');
});

test('后端返回的 key 原样保留（含命名空间前缀）', () => {
  assert.equal(errorKeyOf(apiError('error.wsProjectCorrupt')), 'error.wsProjectCorrupt');
});