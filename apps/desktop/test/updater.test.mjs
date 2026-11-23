import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const {
  DEFAULT_FEED_URL,
  normalizeFeedUrl,
  createUpdatePrefsStore,
  createUpdater,
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

const flush = () => new Promise((resolve) => setImmediate(resolve));

class FakeAutoUpdater extends EventEmitter {
  constructor() {
    super();
    this.checks = 0;
    this.downloads = 0;
    this.installs = 0;
    this.rejectCheck = false;
    this.rejectDownload = false;
  }

  setFeedURL(config) {
    this.feed = config;
  }

  checkForUpdates() {
    this.checks += 1;
    if (this.rejectCheck) return Promise.reject(new Error('check rejected'));
    return Promise.resolve(null);
  }

  downloadUpdate() {
    this.downloads += 1;
    if (this.rejectDownload) return Promise.reject(new Error('download rejected'));
    return Promise.resolve([]);
  }

  quitAndInstall(isSilent, isForceRunAfter) {
    this.installs += 1;
    this.installArgs = [isSilent, isForceRunAfter];
  }
}

function makeUpdater({
  enabled = true,
  isPackaged = true,
  feedUrl,
  deferSchedule = false,
  prefs: prefsOverride,
} = {}) {
  const dir = tmpDir();
  const prefs =
    prefsOverride ?? createUpdatePrefsStore({ dir, logger: silent() });
  if (!prefsOverride) {
    prefs.set({ enabled });
    if (feedUrl) prefs.set({ feedUrl });
  }
  const autoUpdater = new FakeAutoUpdater();
  const states = [];
  const scheduled = [];
  const schedule = deferSchedule
    ? (fn) => {
        scheduled.push(fn);
        return 0;
      }
    : (fn) => {
        fn();
        return 0;
      };
  const controller = createUpdater({
    autoUpdater,
    prefs,
    logger: silent(),
    isPackaged,
    currentVersion: '0.1.0',
    send: (state) => states.push(state),
    startupDelayMs: 0,
    schedule,
  });
  return { autoUpdater, controller, states, prefs, scheduled };
}

test('start 在关闭开关时不检查', () => {
  const { autoUpdater, controller } = makeUpdater({ enabled: false });
  controller.start();
  assert.equal(autoUpdater.checks, 0);
  assert.equal(controller.getState().phase, 'idle');
});

test('关闭开关后仍允许手动检查', () => {
  const { autoUpdater, controller } = makeUpdater({ enabled: false });
  controller.check({ manual: true });
  assert.equal(autoUpdater.checks, 1);
  assert.equal(controller.getState().phase, 'checking');
});

test('非打包环境返回 dev_mode 且不发起请求', () => {
  const { autoUpdater, controller } = makeUpdater({ isPackaged: false });
  const state = controller.check({ manual: true });
  assert.equal(autoUpdater.checks, 0);
  assert.equal(state.error, 'dev_mode');
});

test('非打包环境初始状态就标记 dev_mode', () => {
  const { controller } = makeUpdater({ isPackaged: false });
  assert.equal(controller.getState().phase, 'idle');
  assert.equal(controller.getState().error, 'dev_mode');
});

test('没有新版本时进入 not-available 状态', () => {
  const { autoUpdater, controller } = makeUpdater();
  controller.check();
  autoUpdater.emit('update-not-available', { version: '0.1.0' });
  assert.equal(controller.getState().phase, 'not-available');
  assert.equal(controller.getState().availableVersion, null);
});

test('发现更新后可下载并进入已下载状态', () => {
  const { autoUpdater, controller } = makeUpdater();
  controller.check();
  autoUpdater.emit('checking-for-update');
  autoUpdater.emit('update-available', { version: '0.2.0' });
  assert.equal(controller.getState().phase, 'available');
  assert.equal(controller.getState().availableVersion, '0.2.0');

  const result = controller.download();
  assert.equal(result.ok, true);
  assert.equal(autoUpdater.downloads, 1);

  autoUpdater.emit('download-progress', { percent: 42.6, bytesPerSecond: 1024 });
  assert.equal(controller.getState().phase, 'downloading');
  assert.equal(controller.getState().percent, 43);

  autoUpdater.emit('update-downloaded', { version: '0.2.0' });
  assert.equal(controller.getState().phase, 'downloaded');
  assert.equal(controller.isUpdateReady(), true);

  assert.equal(controller.quitAndInstall(), true);
  assert.equal(autoUpdater.installs, 1);
  assert.deepEqual(autoUpdater.installArgs, [true, true]);
});

test('没有可用版本时下载被拒绝', () => {
  const { autoUpdater, controller } = makeUpdater();
  const result = controller.download();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not_available');
  assert.equal(autoUpdater.downloads, 0);
});

test('检查阶段错误进入 error 状态并记录错误代码', () => {
  const { autoUpdater, controller } = makeUpdater();
  controller.check();
  autoUpdater.emit('error', new Error('network down'));
  assert.equal(controller.getState().phase, 'error');
  assert.equal(controller.getState().error, 'check_failed');
});

test('下载阶段错误记录 download_failed', () => {
  const { autoUpdater, controller } = makeUpdater();
  autoUpdater.emit('update-available', { version: '0.2.0' });
  controller.download();
  autoUpdater.emit('error', new Error('network down'));
  assert.equal(controller.getState().phase, 'error');
  assert.equal(controller.getState().error, 'download_failed');
});

test('修改更新源后重置为 idle 并持久化', () => {
  const { autoUpdater, controller } = makeUpdater();
  autoUpdater.emit('update-available', { version: '0.2.0' });
  const result = controller.setFeedUrl('https://example.com/mirror');
  assert.equal(result.ok, true);
  assert.equal(result.state.feedUrl, 'https://example.com/mirror/');
  assert.equal(result.state.phase, 'idle');
  assert.equal(result.state.availableVersion, null);
});

test('非法更新源被拒绝且状态不变', () => {
  const { controller } = makeUpdater({ feedUrl: 'https://example.com/mirror' });
  const before = controller.getState();
  const result = controller.setFeedUrl('ftp://example.com/');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_url');
  assert.equal(result.state.feedUrl, before.feedUrl);
  assert.equal(result.state.feedUrl, 'https://example.com/mirror/');
});

test('已下载状态不会被迟到事件回退', () => {
  const { autoUpdater, controller } = makeUpdater();
  autoUpdater.emit('update-available', { version: '0.2.0' });
  controller.download();
  autoUpdater.emit('update-downloaded', { version: '0.2.0' });
  assert.equal(controller.getState().percent, 100);

  autoUpdater.emit('download-progress', { percent: 10, bytesPerSecond: 5 });
  autoUpdater.emit('update-available', { version: '0.3.0' });
  autoUpdater.emit('update-not-available', { version: '0.1.0' });
  autoUpdater.emit('checking-for-update');
  autoUpdater.emit('error', new Error('late failure'));

  const state = controller.getState();
  assert.equal(state.phase, 'downloaded');
  assert.equal(state.percent, 100);
  assert.equal(state.availableVersion, '0.2.0');
  assert.equal(controller.isUpdateReady(), true);
  assert.equal(controller.quitAndInstall(), true);
  assert.equal(autoUpdater.installs, 1);
});

test('检查失败只发布一次 error 状态', async () => {
  const { autoUpdater, controller, states } = makeUpdater();
  autoUpdater.rejectCheck = true;
  controller.check();
  autoUpdater.emit('error', new Error('network down'));
  await flush();

  const errors = states.filter((state) => state.phase === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error, 'check_failed');
});

test('仅 Promise 拒绝也能进入 check_failed', async () => {
  const { autoUpdater, controller, states } = makeUpdater();
  autoUpdater.rejectCheck = true;
  controller.check();
  await flush();

  assert.equal(controller.getState().phase, 'error');
  assert.equal(controller.getState().error, 'check_failed');
  assert.equal(states.filter((state) => state.phase === 'error').length, 1);
});

test('下载完成后的安装期错误不丢失就绪状态', () => {
  const { autoUpdater, controller } = makeUpdater();
  autoUpdater.emit('update-available', { version: '0.2.0' });
  controller.download();
  autoUpdater.emit('update-downloaded', { version: '0.2.0' });
  autoUpdater.emit('error', new Error('installer failed'));

  assert.equal(controller.getState().phase, 'downloaded');
  assert.equal(controller.isUpdateReady(), true);
});

test('关闭自动更新只影响启动检查并持久化', () => {
  const { controller, prefs } = makeUpdater();
  const before = controller.getState().phase;

  const disabled = controller.setEnabled(false);
  assert.equal(disabled.ok, true);
  assert.equal(disabled.state.enabled, false);
  assert.equal(disabled.state.phase, before);
  assert.equal(prefs.get().enabled, false);

  const reloaded = createUpdatePrefsStore({
    dir: path.dirname(prefs.file),
    logger: silent(),
  });
  assert.equal(reloaded.get().enabled, false);

  const enabled = controller.setEnabled(true);
  assert.equal(enabled.ok, true);
  assert.equal(enabled.state.enabled, true);
  assert.equal(prefs.get().enabled, true);
});

test('设置开关持久化失败时返回错误且状态不变', () => {
  const real = createUpdatePrefsStore({ dir: tmpDir(), logger: silent() });
  const prefs = {
    get: () => real.get(),
    set: () => ({ ok: false, error: 'persist_failed', settings: real.get() }),
  };
  const { controller } = makeUpdater({ prefs });
  const before = controller.getState();

  const result = controller.setEnabled(false);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'persist_failed');
  assert.deepEqual(controller.getState(), before);
});

test('检查时才应用更新源，修改源延后到下次检查', () => {
  const { autoUpdater, controller } = makeUpdater();
  assert.equal(autoUpdater.feed, undefined);

  controller.check();
  assert.deepEqual(autoUpdater.feed, {
    provider: 'generic',
    url: DEFAULT_FEED_URL,
  });

  autoUpdater.emit('update-available', { version: '0.2.0' });
  autoUpdater.feed = null;
  const result = controller.setFeedUrl('https://example.com/mirror');
  assert.equal(result.ok, true);
  assert.equal(autoUpdater.feed, null);

  controller.check();
  assert.deepEqual(autoUpdater.feed, {
    provider: 'generic',
    url: 'https://example.com/mirror/',
  });
});

test('操作进行中拒绝重复操作', () => {
  const { autoUpdater, controller } = makeUpdater();
  autoUpdater.emit('update-available', { version: '0.2.0' });
  controller.check();
  assert.equal(controller.getState().phase, 'checking');
  assert.deepEqual(controller.download(), { ok: false, error: 'busy' });

  autoUpdater.emit('update-downloaded', { version: '0.2.0' });
  assert.deepEqual(controller.download(), { ok: false, error: 'busy' });
  const checksBefore = autoUpdater.checks;
  controller.check();
  assert.equal(autoUpdater.checks, checksBefore);
  assert.equal(controller.isUpdateReady(), true);
});

test('未下载时 quitAndInstall 返回 false', () => {
  const { autoUpdater, controller } = makeUpdater();
  assert.equal(controller.quitAndInstall(), false);
  assert.equal(autoUpdater.installs, 0);
});

test('下载中或已下载时拒绝修改更新源', () => {
  const downloading = makeUpdater();
  downloading.autoUpdater.emit('update-available', { version: '0.2.0' });
  downloading.controller.download();
  const downloadingBefore = downloading.controller.getState();
  const busyWhileDownloading =
    downloading.controller.setFeedUrl('https://example.com/mirror');
  assert.equal(busyWhileDownloading.ok, false);
  assert.equal(busyWhileDownloading.error, 'busy');
  assert.deepEqual(downloading.controller.getState(), downloadingBefore);
  assert.equal(downloading.prefs.get().feedUrl, DEFAULT_FEED_URL);

  const downloaded = makeUpdater();
  downloaded.autoUpdater.emit('update-available', { version: '0.2.0' });
  downloaded.controller.download();
  downloaded.autoUpdater.emit('update-downloaded', { version: '0.2.0' });
  const downloadedBefore = downloaded.controller.getState();
  const busyWhenReady =
    downloaded.controller.setFeedUrl('https://example.com/mirror');
  assert.equal(busyWhenReady.ok, false);
  assert.equal(busyWhenReady.error, 'busy');
  assert.deepEqual(downloaded.controller.getState(), downloadedBefore);
  assert.equal(downloaded.prefs.get().feedUrl, DEFAULT_FEED_URL);
});

test('下载进度被钳制并传播字节速率', () => {
  const { autoUpdater, controller } = makeUpdater();
  autoUpdater.emit('update-available', { version: '0.2.0' });
  controller.download();

  autoUpdater.emit('download-progress', { percent: 142.7, bytesPerSecond: 2048 });
  assert.equal(controller.getState().percent, 100);
  assert.equal(controller.getState().bytesPerSecond, 2048);
  assert.equal(controller.getState().error, null);

  autoUpdater.emit('download-progress', { percent: Number.NaN, bytesPerSecond: 0 });
  assert.equal(controller.getState().percent, 0);

  autoUpdater.emit('download-progress', { percent: -5, bytesPerSecond: 1 });
  assert.equal(controller.getState().percent, 0);

  autoUpdater.emit('download-progress', { percent: 55, bytesPerSecond: 10 });
  autoUpdater.emit('update-not-available', { version: '0.1.0' });
  assert.equal(controller.getState().phase, 'not-available');
  assert.equal(controller.getState().percent, 0);
  assert.equal(controller.getState().bytesPerSecond, 0);
});

test('发现新版本时清零进度与速率', () => {
  const { autoUpdater, controller } = makeUpdater();
  autoUpdater.emit('download-progress', { percent: 40, bytesPerSecond: 512 });
  autoUpdater.emit('update-available', { version: '0.2.0' });
  assert.equal(controller.getState().percent, 0);
  assert.equal(controller.getState().bytesPerSecond, 0);
});

test('向渲染层推送的是状态副本', () => {
  const { autoUpdater, controller, states } = makeUpdater();
  autoUpdater.emit('update-available', { version: '0.2.0' });

  const captured = states.at(-1);
  captured.phase = 'error';
  captured.availableVersion = '9.9.9';

  assert.equal(controller.getState().phase, 'available');
  assert.equal(controller.getState().availableVersion, '0.2.0');

  const snapshot = controller.getState();
  snapshot.phase = 'downloaded';
  assert.equal(controller.getState().phase, 'available');
});

test('start 只调度一次启动检查', () => {
  const { autoUpdater, controller, scheduled } = makeUpdater({
    deferSchedule: true,
  });
  controller.start();
  controller.start();

  assert.equal(scheduled.length, 1);
  assert.equal(autoUpdater.checks, 0);

  scheduled[0]();
  assert.equal(autoUpdater.checks, 1);
});
