import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  useDbSqlAssistantStore,
  abortThread,
  getThread,
} from '../src/store/dbSqlAssistant.ts';

const TAB = 'dbData:c1:voucher';
const OTHER = 'dbData:c1:ledger';

beforeEach(() => {
  useDbSqlAssistantStore.getState().clearAll();
});

test('default thread is closed, empty and idle', () => {
  const thread = getThread(TAB);
  assert.equal(thread.open, false);
  assert.deepEqual(thread.messages, []);
  assert.equal(thread.busy, false);
  assert.equal(thread.errorKey, null);
});

test('setOpen toggles only the given tab and keeps messages', () => {
  const store = useDbSqlAssistantStore.getState();
  store.appendUser(TAB, '统计金额');
  store.setOpen(TAB, true);

  assert.equal(getThread(TAB).open, true);
  assert.equal(getThread(OTHER).open, false);
  assert.equal(getThread(TAB).messages.length, 1);

  store.setOpen(TAB, false);
  assert.equal(getThread(TAB).open, false);
  assert.equal(getThread(TAB).messages.length, 1, 'closing must not drop history');
});

test('appendUser adds a user message and clears prior error', () => {
  const store = useDbSqlAssistantStore.getState();
  const failed = store.startAssistant(TAB);
  store.fail(TAB, failed.id, 'error.internal');
  assert.equal(getThread(TAB).errorKey, 'error.internal');

  const msg = store.appendUser(TAB, '只看大于 100 万的');
  assert.equal(msg.role, 'user');
  assert.equal(msg.content, '只看大于 100 万的');
  assert.ok(msg.id.length > 0);
  assert.equal(getThread(TAB).errorKey, null);
  assert.deepEqual(getThread(TAB).messages.map((m) => m.role), ['user']);
});

test('startAssistant marks busy and appendDelta streams into that message', () => {
  const store = useDbSqlAssistantStore.getState();
  const assistant = store.startAssistant(TAB);

  assert.equal(assistant.role, 'assistant');
  assert.equal(getThread(TAB).busy, true);

  store.appendDelta(TAB, assistant.id, '可以');
  store.appendDelta(TAB, assistant.id, '使用');

  const messages = getThread(TAB).messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, '可以使用');
});

test('finish clears busy and can mark interrupted', () => {
  const store = useDbSqlAssistantStore.getState();
  const a = store.startAssistant(TAB);
  store.appendDelta(TAB, a.id, '半截');
  store.finish(TAB, a.id, true);

  const thread = getThread(TAB);
  assert.equal(thread.busy, false);
  assert.equal(thread.messages[0].interrupted, true);
  assert.equal(thread.messages[0].content, '半截', 'partial output is kept');
});

test('fail records errorKey, clears busy and leaves content untouched', () => {
  const store = useDbSqlAssistantStore.getState();
  const a = store.startAssistant(TAB);
  store.appendDelta(TAB, a.id, '部分');
  store.fail(TAB, a.id, 'error.llmUnavailable');

  const thread = getThread(TAB);
  assert.equal(thread.errorKey, 'error.llmUnavailable');
  assert.equal(thread.busy, false);
  assert.equal(thread.messages[0].content, '部分');
});

test('tool steps are recorded on the assistant message and resolved', () => {
  const store = useDbSqlAssistantStore.getState();
  const assistant = store.startAssistant(TAB);

  store.appendToolCall(TAB, assistant.id, {
    callId: 'call_1',
    tool: 'preview_table',
    table: 'ledger',
  });

  const pending = getThread(TAB).messages[0].steps ?? [];
  assert.equal(pending.length, 1);
  assert.equal(pending[0].callId, 'call_1');
  assert.equal(pending[0].table, 'ledger');
  assert.equal(pending[0].pending, true);
  assert.equal(pending[0].ok, undefined);

  store.finishToolCall(TAB, assistant.id, {
    callId: 'call_1',
    ok: true,
    summary: 'ledger：5 行 × 3 列',
  });

  const done = getThread(TAB).messages[0].steps ?? [];
  assert.equal(done[0].pending, false);
  assert.equal(done[0].ok, true);
  assert.equal(done[0].summary, 'ledger：5 行 × 3 列');
});

test('a failed tool step keeps its messageKey and does not touch other steps', () => {
  const store = useDbSqlAssistantStore.getState();
  const assistant = store.startAssistant(TAB);
  store.appendToolCall(TAB, assistant.id, { callId: 'c1', tool: 'preview_table', table: 'a' });
  store.appendToolCall(TAB, assistant.id, { callId: 'c2', tool: 'preview_table', table: 'b' });

  store.finishToolCall(TAB, assistant.id, {
    callId: 'c1',
    ok: false,
    summary: 'a：查询失败',
    messageKey: 'error.dbConn',
  });

  const steps = getThread(TAB).messages[0].steps ?? [];
  assert.equal(steps[0].ok, false);
  assert.equal(steps[0].messageKey, 'error.dbConn');
  assert.equal(steps[1].pending, true);
});

test('unknown callId in finishToolCall is a no-op', () => {
  const store = useDbSqlAssistantStore.getState();
  const assistant = store.startAssistant(TAB);
  store.appendToolCall(TAB, assistant.id, { callId: 'c1', tool: 'preview_table', table: 'a' });

  store.finishToolCall(TAB, assistant.id, { callId: 'nope', ok: true, summary: 'x' });

  const steps = getThread(TAB).messages[0].steps ?? [];
  assert.equal(steps.length, 1);
  assert.equal(steps[0].pending, true);
});

test('fail removes an empty assistant bubble but keeps partial output', () => {
  const store = useDbSqlAssistantStore.getState();
  // 尚未产出任何 token 就失败 → 不留空气泡
  const empty = store.startAssistant(TAB);
  store.fail(TAB, empty.id, 'error.llmUnavailable');
  assert.deepEqual(getThread(TAB).messages, []);
  assert.equal(getThread(TAB).errorKey, 'error.llmUnavailable');

  // 已经流出一部分再失败 → 保留内容
  const partial = store.startAssistant(TAB);
  store.appendDelta(TAB, partial.id, '部分');
  store.fail(TAB, partial.id, 'error.internal');
  assert.equal(getThread(TAB).messages.length, 1);
  assert.equal(getThread(TAB).messages[0].content, '部分');
});

test('fail keeps the bubble when it already carries tool steps', () => {
  const store = useDbSqlAssistantStore.getState();
  const assistant = store.startAssistant(TAB);
  store.appendToolCall(TAB, assistant.id, {
    callId: 'c1',
    tool: 'preview_table',
    table: 'ledger',
  });
  store.finishToolCall(TAB, assistant.id, { callId: 'c1', ok: true, summary: 'ok' });

  store.fail(TAB, assistant.id, 'error.internal');

  const messages = getThread(TAB).messages;
  assert.equal(messages.length, 1, '读过样本的记录不能被清掉');
  assert.equal(messages[0].steps?.length, 1);
});

test('interrupting resolves pending tool steps', () => {
  const store = useDbSqlAssistantStore.getState();
  const assistant = store.startAssistant(TAB);
  store.appendToolCall(TAB, assistant.id, {
    callId: 'c1',
    tool: 'preview_table',
    table: 'ledger',
  });

  store.finish(TAB, assistant.id, true);

  const steps = getThread(TAB).messages[0].steps ?? [];
  assert.equal(steps[0].pending, false, '中断后不能永远显示「正在读取…」');
  assert.equal(steps[0].ok, false);
});

test('settling a cleared request does not touch a newer one', () => {
  const store = useDbSqlAssistantStore.getState();
  const old = store.startAssistant(TAB);
  store.setOpen(TAB, true);

  // 清空后立刻发新请求
  store.clearThread(TAB);
  const fresh = store.startAssistant(TAB);

  // 旧请求迟到的 finish/fail 必须是无操作（messageId 已不存在）
  store.finish(TAB, old.id);
  store.fail(TAB, old.id, 'error.internal');

  const thread = getThread(TAB);
  assert.equal(thread.busy, true, '新请求不能被旧请求的收尾清掉');
  assert.equal(thread.errorKey, null);
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.messages[0].id, fresh.id);
});

test('threads are isolated per tab id', () => {
  const store = useDbSqlAssistantStore.getState();
  store.appendUser(TAB, 'a');
  store.appendUser(OTHER, 'b');

  assert.equal(getThread(TAB).messages[0].content, 'a');
  assert.equal(getThread(OTHER).messages[0].content, 'b');
  assert.equal(getThread(TAB).messages.length, 1);
});

test('clearThread empties only that tab', () => {
  const store = useDbSqlAssistantStore.getState();
  store.appendUser(TAB, 'a');
  store.appendUser(OTHER, 'b');
  const failed = store.startAssistant(TAB);
  store.fail(TAB, failed.id, 'error.internal');

  store.clearThread(TAB);

  assert.deepEqual(getThread(TAB).messages, []);
  assert.equal(getThread(TAB).errorKey, null);
  assert.equal(getThread(TAB).busy, false);
  assert.equal(getThread(OTHER).messages.length, 1);
});

test('clearAll empties every thread and aborts in-flight requests', () => {
  const store = useDbSqlAssistantStore.getState();
  store.appendUser(TAB, 'a');
  store.appendUser(OTHER, 'b');

  const controller = new AbortController();
  abortThread(TAB, controller);
  assert.equal(controller.signal.aborted, false);

  store.clearAll();

  assert.deepEqual(useDbSqlAssistantStore.getState().threads, {});
  assert.equal(controller.signal.aborted, true, 'clearAll must cancel generation');
});

test('abortThread cancels only that tab and keeps its history', () => {
  const store = useDbSqlAssistantStore.getState();
  store.appendUser(TAB, 'a');
  const a = new AbortController();
  const b = new AbortController();
  abortThread(TAB, a);
  abortThread(OTHER, b);

  useDbSqlAssistantStore.getState().abortThread(TAB);

  assert.equal(a.signal.aborted, true);
  assert.equal(b.signal.aborted, false);
  assert.equal(getThread(TAB).messages.length, 1, 'abort must not clear history');
});

test('clearThread aborts that thread request only', () => {
  const store = useDbSqlAssistantStore.getState();
  const a = new AbortController();
  const b = new AbortController();
  abortThread(TAB, a);
  abortThread(OTHER, b);

  store.clearThread(TAB);

  assert.equal(a.signal.aborted, true);
  assert.equal(b.signal.aborted, false);
});