import { test } from 'node:test';
import assert from 'node:assert/strict';

import { errorKeyOf, errorTextOf } from '../src/lib/errorKey.ts';

/** 与 api.ts 的 ApiError 同形（name='ApiError' + messageKey）。 */
function apiError(messageKey: string): Error {
  const err = new Error(messageKey);
  err.name = 'ApiError';
  (err as unknown as { messageKey: string }).messageKey = messageKey;
  return err;
}

test('ApiError 返回后端给的 messageKey', () => {
  assert.equal(errorKeyOf(apiError('error.wsLocked')), 'error.wsLocked');
});

test('普通对象上的 messageKey 也能识别（SSE 事件、跨模块异常）', () => {
  assert.equal(errorKeyOf({ messageKey: 'error.notFound' }), 'error.notFound');
});

test('未知错误退回默认文案', () => {
  assert.equal(errorKeyOf(new TypeError('boom')), 'error.internal');
  assert.equal(errorKeyOf(null), 'error.internal');
  assert.equal(errorKeyOf(undefined), 'error.internal');
  assert.equal(errorKeyOf({ messageKey: '' }), 'error.internal');
});

test('可以指定场景化的兜底 key（例如删除失败）', () => {
  assert.equal(errorKeyOf(new Error('x'), 'error.deleteFailed'), 'error.deleteFailed');
});

test('ApiError 的 messageKey 为空时使用兜底', () => {
  assert.equal(errorKeyOf(apiError(''), 'error.opFailed'), 'error.opFailed');
});

test('errorTextOf 去掉 error. 前缀供 useTranslation(error) 使用', () => {
  assert.equal(errorTextOf({ messageKey: 'error.importParse' }), 'importParse');
  assert.equal(errorTextOf(new Error('x')), 'internal');
});