import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSseBuffer } from '../src/lib/reportSse.ts';

const frame = (event: string, data: unknown) =>
  `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;

test('parses a single CRLF frame', () => {
  const { events, rest } = parseSseBuffer(frame('delta', { text: '你好' }));
  assert.equal(rest, '');
  assert.deepEqual(events, [{ event: 'delta', data: { text: '你好' } }]);
});

test('survives CRLF split at every byte boundary', () => {
  const raw = frame('delta', { text: '分片测试' });
  let buffer = '';
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const char of raw) {
    buffer += char;
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.rest;
    events.push(...parsed.events);
  }
  assert.deepEqual(events, [{ event: 'delta', data: { text: '分片测试' } }]);
});

test('parses multiple frames from one chunk', () => {
  const raw = frame('delta', { text: 'a' }) + frame('delta', { text: 'b' });
  const { events } = parseSseBuffer(raw);
  assert.deepEqual(
    events.map((item) => item.data.text),
    ['a', 'b'],
  );
});

test('flushes a trailing frame without a blank line', () => {
  const raw = 'event: done\ndata: {"ok":true}';
  const first = parseSseBuffer(raw);
  assert.deepEqual(first.events, []);
  const flushed = parseSseBuffer(first.rest, true);
  assert.deepEqual(flushed.events, [{ event: 'done', data: { ok: true } }]);
});

test('joins multi-line data and ignores comments', () => {
  const raw = ': keep-alive\nevent: tool\ndata: {"name":"report_set_outline",\ndata: "ok":true}\n\n';
  const { events } = parseSseBuffer(raw);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { name: 'report_set_outline', ok: true });
});

test('keeps the last partial frame in rest', () => {
  const raw = frame('delta', { text: 'a' }) + 'event: delta\r\ndata: {"text":"b"}';
  const { events, rest } = parseSseBuffer(raw);
  assert.equal(events.length, 1);
  assert.match(rest, /"b"/);
});
