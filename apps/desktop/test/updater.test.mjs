import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEFAULT_FEED_URL,
  normalizeFeedUrl,
  createUpdatePrefsStore,
} = require('../src/updater.cjs');

const silent = () => ({ info() {}, error() {} });

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fireeyeaud-update-'));
}

test('normalizeFeedUrl 规范化 http(s) 地址并补结尾斜杠', () => {
  assert.equal(
    normalizeFeedUrl('https://github.com/txboy/fireeyeaud/releases/latest/download'),
    'https://github.com/txboy/fireeyeaud/releases/latest/download/',
  );
  assert.equal(
    normalizeFeedUrl('  http://example.com/updates/  '),
    'http://example.com/updates/',
  );
});

test('normalizeFeedUrl 去掉查询串与 hash', () => {
  assert.equal(
    normalizeFeedUrl('https://example.com/u?token=x#frag'),
    'https://example.com/u/',
  );
});

test('normalizeFeedUrl 拒绝非法协议、空值与带凭据的地址', () => {
  assert.equal(normalizeFeedUrl(''), null);
  assert.equal(normalizeFeedUrl(null), null);
  assert.equal(normalizeFeedUrl('ftp://example.com/'), null);
  assert.equal(normalizeFeedUrl('javascript:alert(1)'), null);
  assert.equal(normalizeFeedUrl('https://user:pass@example.com/'), null);
  assert.equal(normalizeFeedUrl('not a url'), null);
});

test('normalizeFeedUrl 处理空路径、大小写与 IPv6', () => {
  assert.equal(normalizeFeedUrl('https://example.com'), 'https://example.com/');
  assert.equal(
    normalizeFeedUrl('HTTPS://Example.COM/updates'),
    'https://example.com/updates/',
  );
  assert.equal(normalizeFeedUrl('http://[::1]:8080/feed'), 'http://[::1]:8080/feed/');
});

test('配置默认开启，并使用默认 GitHub 地址', () => {
  const store = createUpdatePrefsStore({ dir: tmpDir(), logger: silent() });
  assert.deepEqual(store.get(), { enabled: true, feedUrl: DEFAULT_FEED_URL });
});

test('配置写入后可跨实例读取', () => {
  const dir = tmpDir();
  const store = createUpdatePrefsStore({ dir, logger: silent() });
  const result = store.set({ enabled: false });
  assert.equal(result.ok, true);
  assert.equal(result.settings.enabled, false);

  const reloaded = createUpdatePrefsStore({ dir, logger: silent() });
  assert.equal(reloaded.get().enabled, false);
  assert.equal(reloaded.get().feedUrl, DEFAULT_FEED_URL);
});

test('非法地址不覆盖已保存配置', () => {
  const dir = tmpDir();
  const store = createUpdatePrefsStore({ dir, logger: silent() });
  store.set({ feedUrl: 'https://example.com/mirror' });
  const result = store.set({ feedUrl: 'ftp://example.com/' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_url');
  assert.equal(store.get().feedUrl, 'https://example.com/mirror/');

  const reloaded = createUpdatePrefsStore({ dir, logger: silent() });
  assert.equal(reloaded.get().feedUrl, 'https://example.com/mirror/');
});

test('重命名失败时清理临时文件并回滚缓存', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'update-settings.json'));
  const store = createUpdatePrefsStore({ dir, logger: silent() });
  const before = store.get();
  const result = store.set({ enabled: false });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'persist_failed');
  assert.deepEqual(store.get(), before);
  assert.equal(fs.existsSync(path.join(dir, 'update-settings.json.tmp')), false);
});

test('配置文件损坏时回退默认值', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'update-settings.json'), '{bad', 'utf8');
  const store = createUpdatePrefsStore({ dir, logger: silent() });
  assert.deepEqual(store.get(), { enabled: true, feedUrl: DEFAULT_FEED_URL });
});

test('配置文件缺字段时逐项回退', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, 'update-settings.json'),
    JSON.stringify({ enabled: false }),
    'utf8',
  );
  const store = createUpdatePrefsStore({ dir, logger: silent() });
  assert.deepEqual(store.get(), { enabled: false, feedUrl: DEFAULT_FEED_URL });
});

test('配置中存了非法地址时回退默认地址', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, 'update-settings.json'),
    JSON.stringify({ enabled: true, feedUrl: 'ftp://example.com/' }),
    'utf8',
  );
  const store = createUpdatePrefsStore({ dir, logger: silent() });
  assert.equal(store.get().feedUrl, DEFAULT_FEED_URL);
});

test('写入失败时返回 persist_failed 且不污染缓存', () => {
  const root = tmpDir();
  const dir = path.join(root, 'not-a-dir');
  fs.writeFileSync(dir, 'x', 'utf8');
  const store = createUpdatePrefsStore({ dir, logger: silent() });
  const before = store.get();
  const result = store.set({ enabled: false });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'persist_failed');
  assert.deepEqual(result.settings, before);
  assert.deepEqual(store.get(), before);
});
