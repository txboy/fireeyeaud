import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSqlChatHistory } from '../src/lib/dbSqlHistory.ts';

const user = (content: string) => ({ role: 'user' as const, content });
const assistant = (content: string) => ({ role: 'assistant' as const, content });

test('appends the new user message after the existing history', () => {
  const out = buildSqlChatHistory([user('a'), assistant('b')], 'c');
  assert.deepEqual(
    out.map((m) => `${m.role}:${m.content}`),
    ['user:a', 'assistant:b', 'user:c'],
  );
});

test('keeps only the most recent 20 messages including the new one', () => {
  // 以 user 开头、user 结尾的合法对话（每轮一问一答）
  const history = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 === 0 ? ('assistant' as const) : ('user' as const),
    content: `m${i}`,
  }));
  const out = buildSqlChatHistory(history, 'new');

  assert.equal(out.length, 20);
  assert.equal(out.at(-1)?.content, 'new');
  assert.equal(out[0]?.role, 'user');
  // 41 条里取最近 20 条 → m21..m39 + new，m21 是 user
  assert.equal(out[0]?.content, 'm21');
});

test('drops a leading assistant message so the turn starts with the user', () => {
  // 历史上第一条是 assistant（例如早期清空过用户消息）
  const shifted = [assistant('a0'), user('u1'), assistant('a1')];
  const out = buildSqlChatHistory(shifted, 'new');
  assert.equal(out[0]?.role, 'user');
  assert.deepEqual(
    out.map((m) => m.content),
    ['u1', 'a1', 'new'],
  );
});

test('drops empty assistant placeholders (e.g. an earlier failed turn)', () => {
  const out = buildSqlChatHistory([user('a'), assistant(''), assistant('  ')], 'b');
  assert.deepEqual(
    out.map((m) => `${m.role}:${m.content}`),
    ['user:a', 'user:b'],
  );
});

test('enforces the 40KB total budget from the newest message backwards', () => {
  const big = 'x'.repeat(30_000);
  const out = buildSqlChatHistory([user(big), assistant(big), user('tail')], 'new');

  const total = out.reduce((sum, m) => sum + m.content.length, 0);
  assert.ok(total <= 40_000, `history too big: ${total}`);
  assert.equal(out.at(-1)?.content, 'new', 'newest message is always kept');
  assert.equal(out.at(-2)?.content, 'tail');
});

test('returns just the new message for an empty thread', () => {
  assert.deepEqual(buildSqlChatHistory([], 'hi'), [user('hi')]);
});