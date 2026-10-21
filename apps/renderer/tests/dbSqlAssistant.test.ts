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
  store.fail(TAB, 'x', 'error.internal');
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
  store.fail(TAB, 'x', 'error.internal');

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