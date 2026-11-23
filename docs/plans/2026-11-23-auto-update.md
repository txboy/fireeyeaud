# 火眼审计助手自动更新（版本监测）实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Windows 桌面端加入可开关的版本监测：启动时检查 GitHub Releases，发现新版本后由用户确认下载，下载完成提示重启，退出应用时静默替换为新版本。

**Architecture:** 主进程新增 `updater.cjs`，用 `electron-updater` 的 generic provider 指向 GitHub Releases 的 `latest/download` 前缀；配置存 `userData/update-settings.json`；渲染层通过 IPC 订阅状态并驱动设置面板与状态栏。`before-quit` 改造为「先停 sidecar，再决定是否调用 `quitAndInstall`」，避免现有 `app.exit(0)` 绕过 electron-updater 的安装钩子。

**Tech Stack:** Electron 44、electron-builder 26、electron-updater 6、React 18、antd 5、zustand 5、node:test。

---

## 前置约束（执行前必读）

- 更新只在 `app.isPackaged === true` 时工作；`npm run dev` 与 `release/win-unpacked` 直接运行不会检查更新。
- 采用 **generic provider**，默认地址：
  `https://github.com/txboy/fireeyeaud/releases/latest/download/`
- `autoDownload = false`、`autoInstallOnAppQuit = false`，所有下载/安装均由用户确认。
- 只支持 Windows NSIS 安装版；macOS/Linux、灰度、强制更新、回滚、差分之外的增量策略本期不做。
- 所有路径以仓库根 `E:\fireeyeaud` 为基准；在独立 worktree 中执行时同样适用。

---

### Task 1: 依赖、发布配置与共享类型

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `packages/shared/src/types.ts`
- Modify: `package-lock.json`（由 npm 生成）

**Step 1: 安装 electron-updater**

Run:

```powershell
npm install electron-updater@^6.8.11 -w @fireeyeaud/desktop
```

Expected: `apps/desktop/package.json` 的 `dependencies` 中出现 `"electron-updater": "^6.8.11"`，`package-lock.json` 更新。

**Step 2: 增加 electron-builder 的 publish 配置**

修改 `apps/desktop/package.json` 的 `build` 字段，在 `"productName"` 之后加入：

```json
    "publish": [
      {
        "provider": "generic",
        "url": "https://github.com/txboy/fireeyeaud/releases/latest/download/"
      }
    ],
```

说明：这一步保证打包时生成 `latest.yml` 并写入 `app-update.yml`；运行期仍会用用户配置的地址覆盖。

**Step 3: 在 shared 中定义更新相关类型**

在 `packages/shared/src/types.ts` 末尾追加：

```ts
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type UpdateErrorCode =
  /** 输入参数非法（例如 enabled 不是布尔值）。 */
  | 'invalid_input'
  | 'dev_mode'
  | 'invalid_url'
  | 'persist_failed'
  | 'unavailable'
  | 'not_available'
  | 'busy'
  | 'check_failed'
  | 'download_failed';

export interface UpdateState {
  /** 是否在启动时自动检查。 */
  enabled: boolean;
  /** generic provider 基地址；规范化后始终以 / 结尾。 */
  feedUrl: string;
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  /** 下载进度，0-100 的整数。 */
  percent: number;
  /** 当前下载速度，字节/秒。 */
  bytesPerSecond: number;
  /** 失败原因代码；详细堆栈写日志，不进入状态。 */
  error: UpdateErrorCode | null;
}

export interface UpdateResult {
  ok: boolean;
  error?: UpdateErrorCode;
  /** updater 未创建或参数校验失败时为 null。 */
  state: UpdateState | null;
}
```

`packages/shared/src/index.ts` 已有 `export * from './types';`，无需改动。

**Step 4: 验证 workspace 仍能类型检查**

Run:

```powershell
npm run renderer:typecheck
```

Expected: PASS（此时业务代码还没引用新类型）。

**Step 5: Commit**

```powershell
git add apps/desktop/package.json package-lock.json packages/shared/src/types.ts
git commit -m "feat(update): add electron-updater dependency and update types"
```

---

### Task 2: 更新源校验与配置持久化（TDD）

**Files:**
- Create: `apps/desktop/test/updater.test.mjs`
- Create: `apps/desktop/src/updater.cjs`

**Step 1: 写失败测试（只覆盖 URL 与配置存储）**

创建 `apps/desktop/test/updater.test.mjs`：

```js
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
```

**Step 2: 运行测试确认失败**

Run:

```powershell
npm run desktop:test
```

Expected: FAIL，报错 `Cannot find module '../src/updater.cjs'`。

**Step 3: 写最小实现（仅 URL 与配置存储）**

创建 `apps/desktop/src/updater.cjs`：

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** 默认更新源：GitHub Releases 的 latest 资产前缀。 */
const DEFAULT_FEED_URL =
  'https://github.com/txboy/fireeyeaud/releases/latest/download/';
const PREFS_FILE = 'update-settings.json';
const STARTUP_DELAY_MS = 9000;

/** 只接受 http(s)、无凭据的地址；统一补结尾斜杠并去掉 query/hash。 */
function normalizeFeedUrl(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  return url.toString();
}

/** 读写 userData/update-settings.json；损坏时回退默认值。 */
function createUpdatePrefsStore({ dir, logger = console }) {
  const file = path.join(dir, PREFS_FILE);
  const defaults = { enabled: true, feedUrl: DEFAULT_FEED_URL };
  let cache = null;

  function load() {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err?.code !== 'ENOENT') logger.error(`[update] failed to read settings: ${err}`);
      return { ...defaults };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.error(`[update] invalid json in ${file}, using defaults`);
      return { ...defaults };
    }
    const hasFeed = typeof parsed?.feedUrl === 'string';
    const feedUrl = hasFeed ? normalizeFeedUrl(parsed.feedUrl) : null;
    if (hasFeed && !feedUrl) {
      logger.error(`[update] invalid feed url in ${file}, using default`);
    }
    return {
      enabled:
        typeof parsed?.enabled === 'boolean' ? parsed.enabled : defaults.enabled,
      feedUrl: feedUrl ?? defaults.feedUrl,
    };
  }

  function get() {
    if (!cache) cache = load();
    return { ...cache };
  }

  function set(patch) {
    const current = get();
    const next = { ...current };
    if (typeof patch?.enabled === 'boolean') next.enabled = patch.enabled;
    if (patch?.feedUrl !== undefined) {
      const feedUrl = normalizeFeedUrl(patch.feedUrl);
      if (!feedUrl) return { ok: false, error: 'invalid_url', settings: current };
      next.feedUrl = feedUrl;
    }
    cache = next;
    // 临时文件 + rename 保证不会留下写坏的文件；不做 fsync，
    // 极端断电时可能丢失最后一次偏好变更，对开关类配置可接受。
    const tmp = `${file}.tmp`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      logger.error(`[update] failed to persist settings: ${err}`);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* ignore cleanup failure */
      }
      cache = current;
      return { ok: false, error: 'persist_failed', settings: { ...current } };
    }
    return { ok: true, settings: { ...next } };
  }

  return { get, set, file };
}

module.exports = {
  DEFAULT_FEED_URL,
  PREFS_FILE,
  STARTUP_DELAY_MS,
  normalizeFeedUrl,
  createUpdatePrefsStore,
};
```

**Step 4: 运行测试确认通过**

Run:

```powershell
npm run desktop:test
```

Expected: PASS，全部 12 个测试通过。

**Step 5: Commit**

```powershell
git add apps/desktop/src/updater.cjs apps/desktop/test/updater.test.mjs
git commit -m "feat(update): validate feed url and persist update prefs"
```

---

### Task 3: 更新状态机控制器（TDD）

**Files:**
- Modify: `apps/desktop/test/updater.test.mjs`
- Modify: `apps/desktop/src/updater.cjs`

**Step 1: 追加失败测试**

在 `apps/desktop/test/updater.test.mjs` 顶部补充：

```js
import { EventEmitter } from 'node:events';
```

在文件末尾追加：

```js
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
```

同时把文件顶部的解构改为：

```js
const {
  DEFAULT_FEED_URL,
  normalizeFeedUrl,
  createUpdatePrefsStore,
  createUpdater,
} = require('../src/updater.cjs');
```

**Step 2: 运行测试确认失败**

Run:

```powershell
npm run desktop:test
```

Expected: FAIL，`createUpdater is not a function`。

**Step 3: 实现控制器**

在 `apps/desktop/src/updater.cjs` 的 `createUpdatePrefsStore` 之后、`module.exports` 之前加入：

```js
/**
 * 包装 electron-updater：维护状态、推送渲染层、把下载/安装决定权交给用户。
 * 依赖通过参数注入，便于用 FakeAutoUpdater 做单测。
 */
function createUpdater({
  autoUpdater,
  prefs,
  logger = console,
  isPackaged,
  currentVersion,
  send = () => {},
  startupDelayMs = STARTUP_DELAY_MS,
  schedule = setTimeout,
}) {
  const settings = prefs.get();
  let state = {
    enabled: settings.enabled,
    feedUrl: settings.feedUrl,
    phase: 'idle',
    currentVersion,
    availableVersion: null,
    percent: 0,
    bytesPerSecond: 0,
    error: null,
  };

  function publish(patch) {
    state = { ...state, ...patch };
    send({ ...state });
    return { ...state };
  }

  // 下载完成后状态必须保持“已就绪”，否则迟到的 progress/available 事件
  // 会把 isUpdateReady() 打回 false，导致退出时静默跳过安装。
  function publishUnlessReady(patch) {
    if (state.phase === 'downloaded') return { ...state };
    return publish(patch);
  }

  function onError(err) {
    logger.error(`[update] ${err?.stack || err}`);
    if (state.phase === 'downloaded') return; // 安装期错误不能丢掉就绪状态
    publish({
      phase: 'error',
      error: state.phase === 'downloading' ? 'download_failed' : 'check_failed',
    });
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
    info: (...args) => logger.info(...args),
    warn: (...args) => logger.error(...args),
    error: (...args) => logger.error(...args),
    debug: () => {},
  };

  autoUpdater.on('checking-for-update', () =>
    publishUnlessReady({ phase: 'checking', error: null }),
  );
  autoUpdater.on('update-available', (info) =>
    publishUnlessReady({
      phase: 'available',
      availableVersion: info?.version ?? null,
      percent: 0,
      bytesPerSecond: 0,
      error: null,
    }),
  );
  autoUpdater.on('update-not-available', () =>
    publishUnlessReady({
      phase: 'not-available',
      availableVersion: null,
      percent: 0,
      bytesPerSecond: 0,
      error: null,
    }),
  );
  autoUpdater.on('download-progress', (progress) => {
    const rounded = Math.round(progress?.percent ?? 0);
    const percent = Number.isFinite(rounded)
      ? Math.min(100, Math.max(0, rounded))
      : 0;
    publishUnlessReady({
      phase: 'downloading',
      percent,
      bytesPerSecond: progress?.bytesPerSecond ?? 0,
      error: null,
    });
  });
  autoUpdater.on('update-downloaded', (info) =>
    publish({
      phase: 'downloaded',
      availableVersion: info?.version ?? state.availableVersion,
      percent: 100,
      bytesPerSecond: 0,
      error: null,
    }),
  );
  autoUpdater.on('error', onError);

  function applyFeed() {
    autoUpdater.setFeedURL({ provider: 'generic', url: state.feedUrl });
  }

  function check({ manual = false } = {}) {
    if (!isPackaged) {
      return publish({ phase: 'idle', error: 'dev_mode' });
    }
    if (!manual && !state.enabled) return { ...state };
    if (state.phase === 'checking' || state.phase === 'downloading') {
      return { ...state };
    }
    if (state.phase === 'downloaded') return { ...state };
    applyFeed();
    publish({ phase: 'checking', error: null });
    try {
      const result = autoUpdater.checkForUpdates();
      if (result && typeof result.catch === 'function') {
        result.catch((err) => {
          // error 事件是主信号；只有事件没被触发时才由拒绝兜底，避免重复发布。
          if (state.phase === 'checking') onError(err);
        });
      }
    } catch (err) {
      onError(err);
    }
    return { ...state };
  }

  // 开关只控制启动时的自动检查；关闭后手动检查/下载仍然可用，
  // 也不会取消正在进行的下载。
  function setEnabled(enabled) {
    const result = prefs.set({ enabled: Boolean(enabled) });
    if (!result.ok) {
      return { ok: false, error: result.error, state: { ...state } };
    }
    return { ok: true, state: publish({ enabled: result.settings.enabled }) };
  }

  function setFeedUrl(feedUrl) {
    if (
      state.phase === 'checking' ||
      state.phase === 'downloading' ||
      state.phase === 'downloaded'
    ) {
      return { ok: false, error: 'busy', state: { ...state } };
    }
    const result = prefs.set({ feedUrl });
    if (!result.ok) {
      return { ok: false, error: result.error, state: { ...state } };
    }
    return {
      ok: true,
      state: publish({
        feedUrl: result.settings.feedUrl,
        phase: 'idle',
        availableVersion: null,
        percent: 0,
        bytesPerSecond: 0,
        error: null,
      }),
    };
  }

  function download() {
    if (!state.availableVersion) {
      return { ok: false, error: 'not_available' };
    }
    if (
      state.phase === 'checking' ||
      state.phase === 'downloading' ||
      state.phase === 'downloaded'
    ) {
      return { ok: false, error: 'busy' };
    }
    publish({ phase: 'downloading', percent: 0, error: null });
    try {
      const result = autoUpdater.downloadUpdate();
      if (result && typeof result.catch === 'function') {
        result.catch((err) => {
          if (state.phase === 'downloading') onError(err);
        });
      }
    } catch (err) {
      onError(err);
      return { ok: false, error: 'download_failed' };
    }
    return { ok: true };
  }

  function isUpdateReady() {
    return state.phase === 'downloaded';
  }

  // 返回值表示“已请求安装”，不代表安装器一定成功启动；
  // Task 4 会在 before-quit 里安排兜底退出。
  function quitAndInstall() {
    if (!isUpdateReady()) return false;
    autoUpdater.quitAndInstall(true, true);
    return true;
  }

  let started = false;
  function start() {
    if (started || !isPackaged || !state.enabled) return;
    started = true;
    const timer = schedule(() => {
      started = false;
      check();
    }, startupDelayMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  return {
    getState: () => ({ ...state }),
    start,
    check,
    setEnabled,
    setFeedUrl,
    download,
    isUpdateReady,
    quitAndInstall,
  };
}
```

并把导出改为：

```js
module.exports = {
  DEFAULT_FEED_URL,
  PREFS_FILE,
  STARTUP_DELAY_MS,
  normalizeFeedUrl,
  createUpdatePrefsStore,
  createUpdater,
};
```

**Step 4: 运行测试确认通过**

Run:

```powershell
npm run desktop:test
```

Expected: PASS，12 个配置测试 + 24 个控制器测试（共 36）全部通过。

**Step 5: Commit**

```powershell
git add apps/desktop/src/updater.cjs apps/desktop/test/updater.test.mjs
git commit -m "feat(update): add updater state machine with download/install gating"
```

---

### Task 4: 主进程与 preload 接线

**Files:**
- Modify: `apps/desktop/src/main.cjs:3-22`（require 区）
- Modify: `apps/desktop/src/main.cjs:39-44`（模块变量）
- Modify: `apps/desktop/src/main.cjs:212-218`（`app:info` 之后）
- Modify: `apps/desktop/src/main.cjs:575-610`（whenReady）
- Modify: `apps/desktop/src/main.cjs:621-630`（before-quit）
- Modify: `apps/desktop/src/preload.cjs:44-49`
- Create: `apps/desktop/src/quit-flow.cjs`
- Create: `apps/desktop/test/quit-flow.test.mjs`

**Step 1: 引入 electron-updater、updater 与 quit-flow 模块**

在 `apps/desktop/src/main.cjs` 的 require 区加入：

```js
const { autoUpdater } = require('electron-updater');
const { createUpdatePrefsStore, createUpdater } = require('./updater.cjs');
const { createQuitFlow } = require('./quit-flow.cjs');
```

在 `let secrets = null;` 之后加入：

```js
let updater = null;
```

**Step 2: 注册更新 IPC**

在 `registerIpc()` 内、`app:info` 处理器之后加入：

```js
  ipcMain.handle('update:get-state', () => updater?.getState() ?? null);
  ipcMain.handle('update:set-enabled', (_event, enabled) => {
    if (!updater) return { ok: false, error: 'unavailable', state: null };
    if (typeof enabled !== 'boolean') {
      return { ok: false, error: 'invalid_input', state: updater.getState() };
    }
    return updater.setEnabled(enabled);
  });
  ipcMain.handle(
    'update:set-feed',
    (_event, url) =>
      updater?.setFeedUrl(url) ?? { ok: false, error: 'unavailable', state: null },
  );
  ipcMain.handle('update:check', () =>
    updater
      ? { ok: true, state: updater.check({ manual: true }) }
      : { ok: false, error: 'unavailable', state: null },
  );
  ipcMain.handle('update:download', () =>
    updater
      ? { ...updater.download(), state: updater.getState() }
      : { ok: false, error: 'unavailable', state: null },
  );
  // 走正常退出路径：before-quit 会判断是否已下载并触发静默安装。
  ipcMain.handle('update:install', () => {
    if (!updater || !updater.isUpdateReady()) {
      return {
        ok: false,
        error: 'not_available',
        state: updater?.getState() ?? null,
      };
    }
    const state = updater.getState();
    app.quit();
    return { ok: true, state };
  });
```

说明：`update:get-state` 保持返回状态本身或 `null`；其余命令统一返回完整的
`UpdateResult` 形状 `{ ok, error?, state }`（`state` 可为 `null`），避免渲染层拿到 `null`
后分不清“不可用”与“无状态”。`download()` 在 `not_available` / `busy` 时不带 state，
因此处理器必须补上 `state: updater.getState()`。`set-enabled` 只接受布尔值，不做隐式转换。

**Step 3: 在 whenReady 中创建 updater 并启动**

先抽出统一的窗口推送函数（`broadcastStatus` 也改用它），避免向已销毁的 webContents 发送：

```js
function sendToMainWindow(channel, payload) {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed()
  ) {
    mainWindow.webContents.send(channel, payload);
  }
}

function broadcastStatus(info) {
  sendToMainWindow('sidecar:status', info);
}
```

在 `app.whenReady().then(async () => {` 内、`registerIpc();` 之前加入：

```js
  updater = createUpdater({
    autoUpdater,
    prefs: createUpdatePrefsStore({ dir: app.getPath('userData'), logger }),
    logger,
    isPackaged: app.isPackaged,
    currentVersion: app.getVersion(),
    send: (state) => sendToMainWindow('update:state', state),
  });
```

在 `sidecar.start()` 调用之后加入：

```js
  updater.start();
```

**Step 4: 用 quit-flow 模块替换内联 before-quit**

退出流程有两个独立状态，不能合并成一个 `quitting` 布尔值：

- `shutdownStarted`：已经收到第一次退出请求，正在停 sidecar；此时再来的退出请求
  必须继续 `preventDefault()`，否则 Electron 会立刻退出，已下载的更新来不及安装。
- `allowQuit`：sidecar 已停、正准备调用 `quitAndInstall()`；`quitAndInstall` 内部会
  同步再次触发 `app.quit()`，这时必须直接放行，否则会自己把自己卡住。

新建 `apps/desktop/src/quit-flow.cjs`：

```js
'use strict';

/**
 * 退出流程：先停 sidecar，再决定是否拉起已下载的更新安装器。
 * 依赖全部注入，便于单测。
 */
function createQuitFlow({
  app,
  sidecar,
  getUpdater,
  logger = console,
  stopWorkspaceWatch = () => {},
  sidecarStopTimeoutMs = 5000,
  installTimeoutMs = 5000,
}) {
  let shutdownStarted = false;
  let allowQuit = false;

  /** 等待 sidecar 停止，超时则继续退出。 */
  function stopSidecar() {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        logger.error('[quit] sidecar stop timed out, continuing shutdown');
        resolve();
      }, sidecarStopTimeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      Promise.resolve()
        .then(() => sidecar.stop())
        .catch((err) => logger.error(`[sidecar] stop failed: ${err}`))
        .finally(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        });
    });
  }

  function finishQuit() {
    const updater = getUpdater();
    const ready = Boolean(updater && updater.isUpdateReady && updater.isUpdateReady());
    if (!ready) {
      app.exit(0);
      return;
    }
    // 必须先把 allowQuit 置为 true：quitAndInstall 内部会同步再次 app.quit()，
    // 那时 before-quit 必须直接放行，否则会再次 preventDefault 把自己卡住。
    allowQuit = true;
    try {
      updater.quitAndInstall();
    } catch (err) {
      logger.error(`[update] quitAndInstall failed: ${err}`);
      app.exit(0);
      return;
    }
    logger.info('[update] installing downloaded update on quit');
    // 故意不 unref：这个看门狗就是用来兜底进程不退出的情况。
    setTimeout(() => {
      logger.error('[update] installer did not quit the app, forcing exit');
      app.exit(0);
    }, installTimeoutMs);
  }

  function onBeforeQuit(event) {
    if (allowQuit) return;
    event.preventDefault();
    if (shutdownStarted) return;
    shutdownStarted = true;
    stopWorkspaceWatch();
    stopSidecar().then(finishQuit);
  }

  return { onBeforeQuit };
}

module.exports = { createQuitFlow };
```

在 `main.cjs` 的 `sidecar` 常量之后创建（`getUpdater` 惰性求值，模块加载期就绪）：

```js
// getUpdater 是惰性的：quitFlow 在模块加载期就绪，updater 稍后在 whenReady 里创建。
const quitFlow = createQuitFlow({
  app,
  sidecar,
  getUpdater: () => updater,
  logger,
  stopWorkspaceWatch,
});
```

把原来的 `before-quit` 处理器整体替换为：

```js
app.on('before-quit', (event) => quitFlow.onBeforeQuit(event));
```

补充：sidecar 停止设 5s 超时；安装看门狗 5s 且**不** `unref()`（它必须在进程本该
退出却卡住时仍然触发）；`quitAndInstall()` 抛错时回退 `app.exit(0)`。`app.exit(0)`
只能由 quit-flow 调用。

**Step 5: 暴露 preload API**

在 `apps/desktop/src/preload.cjs` 的 `onSidecarStatus` 之后加入：

```js
  updates: {
    getState: () => ipcRenderer.invoke('update:get-state'),
    setEnabled: (enabled) => ipcRenderer.invoke('update:set-enabled', enabled),
    setFeedUrl: (url) => ipcRenderer.invoke('update:set-feed', url),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on('update:state', handler);
      return () => ipcRenderer.removeListener('update:state', handler);
    },
  },
```

**Step 6: 语法检查与现有测试**

Run:

```powershell
node --check apps/desktop/src/main.cjs
node --check apps/desktop/src/preload.cjs
node --check apps/desktop/src/quit-flow.cjs
node --test apps/desktop/test/quit-flow.test.mjs
npm run desktop:test
```

Expected: 三条 `node --check` 无输出且退出码 0；`quit-flow.test.mjs` 7 个用例全通过
（重复退出拦截、正常退出、就绪安装、安装抛错、sidecar 拒绝、sidecar 超时、
`stopWorkspaceWatch` 只调用一次）；`desktop:test` 除本机缺 `uvicorn` 的 2 个
sidecar 环境用例外全部通过。

**Step 7: Commit**

```powershell
git add apps/desktop/src/main.cjs apps/desktop/src/preload.cjs apps/desktop/src/quit-flow.cjs apps/desktop/test/quit-flow.test.mjs
git commit -m "feat(update): wire updater into main process and preload"
```

---

### Task 5: 渲染层类型与 zustand store

**Files:**
- Modify: `apps/renderer/src/env.d.ts`
- Create: `apps/renderer/src/store/updates.ts`
- Modify: `apps/renderer/src/App.tsx`

**Step 1: 声明 preload 类型**

把 `apps/renderer/src/env.d.ts` 第一行的类型导入改为：

```ts
import type {
  AppInfo,
  FsDeleteResult,
  FsEntry,
  FsFileContent,
  FsOpResult,
  FsWriteResult,
  SearchOptions,
  SearchResult,
  SidecarInfo,
  UpdateErrorCode,
  UpdateResult,
  UpdateState,
} from '@fireeyeaud/shared';
```

在 `fireeyeaud` 对象内、`onSidecarStatus` 之后加入：

```ts
      updates: {
        getState: () => Promise<UpdateState | null>;
        setEnabled: (enabled: boolean) => Promise<UpdateResult | null>;
        setFeedUrl: (url: string) => Promise<UpdateResult | null>;
        check: () => Promise<UpdateResult | null>;
        download: () => Promise<UpdateResult | null>;
        install: () => Promise<UpdateResult | null>;
        onState: (callback: (state: UpdateState) => void) => () => void;
      };
```

**Step 2: 创建 updates store**

创建 `apps/renderer/src/store/updates.ts`：

```ts
import { create } from 'zustand';
import type { UpdateErrorCode, UpdateState } from '@fireeyeaud/shared';

const initialState: UpdateState = {
  enabled: true,
  feedUrl: '',
  phase: 'idle',
  currentVersion: '',
  availableVersion: null,
  percent: 0,
  bytesPerSecond: 0,
  error: null,
};

interface UpdatesStore extends UpdateState {
  ready: boolean;
  init: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setFeedUrl: (feedUrl: string) => Promise<{ ok: boolean; error?: UpdateErrorCode }>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
}

let subscribed = false;

/** 主进程负责检查/下载；这里只镜像状态并转发命令。 */
export const useUpdatesStore = create<UpdatesStore>((set) => ({
  ...initialState,
  ready: false,
  init: async () => {
    const api = window.fireeyeaud?.updates;
    if (!api || subscribed) return;
    subscribed = true;
    const state = await api.getState();
    if (state) set({ ...state, ready: true });
    api.onState((next) => set({ ...next, ready: true }));
  },
  setEnabled: async (enabled) => {
    const result = await window.fireeyeaud?.updates?.setEnabled(enabled);
    if (result?.state) set(result.state);
  },
  setFeedUrl: async (feedUrl) => {
    const result = await window.fireeyeaud?.updates?.setFeedUrl(feedUrl);
    if (result?.state) set(result.state);
    return { ok: Boolean(result?.ok), error: result?.error };
  },
  check: async () => {
    const result = await window.fireeyeaud?.updates?.check();
    if (result?.state) set(result.state);
  },
  download: async () => {
    const result = await window.fireeyeaud?.updates?.download();
    if (result?.state) set(result.state);
  },
  install: async () => {
    try {
      await window.fireeyeaud?.updates?.install();
    } catch {
      // 主进程退出或 IPC 中断时 Promise 可能 reject；吞掉以避免未处理的拒绝。
    }
  },
}));
```

**Step 3: 在 App 挂载时初始化**

在 `apps/renderer/src/App.tsx` 中：

1. 新增导入：

```tsx
import { useUpdatesStore } from './store/updates';
```

2. 在组件内、`useEffect(() => { void init(); }, [init]);` 旁边加入：

```tsx
  const initUpdates = useUpdatesStore((s) => s.init);

  useEffect(() => {
    void initUpdates();
  }, [initUpdates]);
```

**Step 4: 类型检查**

Run:

```powershell
npm run renderer:typecheck
```

Expected: PASS。

**Step 5: Commit**

```powershell
git add packages/shared/src/types.ts apps/desktop/src/main.cjs apps/renderer/src/env.d.ts apps/renderer/src/store/updates.ts apps/renderer/src/App.tsx docs/plans/2026-11-23-auto-update.md
git commit -m "feat(update): add renderer update store and normalize IPC results"
```

---

### Task 6: 设置面板与中英文案

**Files:**
- Modify: `apps/renderer/src/components/panels/SettingsPanel.tsx`
- Modify: `packages/shared/src/locales/zh-CN.ts:1005-1028`
- Modify: `packages/shared/src/locales/en-US.ts:1004-1029`

**Step 1: 补中文文案**

在 `packages/shared/src/locales/zh-CN.ts` 的 `settings` 对象内、`saved` 之前加入：

```ts
    updateSection: '版本更新',
    autoUpdateEnabled: '启动时自动检查更新',
    updateFeed: '更新源地址',
    updateFeedHint: '默认指向 GitHub Releases；内网环境可改为镜像地址，需以 http:// 或 https:// 开头。',
    updateApplyFeed: '应用地址',
    updateCurrent: '当前版本 {{version}}',
    updateCheck: '检查更新',
    updateChecking: '正在检查…',
    updateNotChecked: '尚未检查',
    updateIdle: '已是最新版本',
    updateAvailable: '发现新版本 {{version}}',
    updateDownload: '下载并安装',
    updateDownloading: '正在下载 {{percent}}%',
    updateDownloaded: '新版本 {{version}} 已下载',
    updateRestart: '立即重启安装',
    updateLater: '稍后',
    updateAvailableBadge: '有新版本 {{version}}',
    updateReadyBadge: '待重启更新',
    updateAvailableTitle: '发现新版本 {{version}}',
    updateAvailableBody: '可下载并安装新版本，下载完成后会询问是否重启。',
    updateReadyTitle: '新版本已就绪',
    updateReadyBody:
      '新版本 {{version}} 已下载完成。可立即重启安装，或下次退出应用时自动安装。',
    updateFailed: '检查更新失败，请检查网络或更新源地址',
    updateDevMode: '开发模式不检查更新',
    updateFeedInvalid: '更新源地址无效，需以 http:// 或 https:// 开头',
    updateFeedBusy: '正在检查或下载更新，请稍后再试',
```

**Step 2: 补英文文案**

在 `packages/shared/src/locales/en-US.ts` 的 `settings` 对象内、`saved` 之前加入：

```ts
    updateSection: 'Version updates',
    autoUpdateEnabled: 'Check for updates at startup',
    updateFeed: 'Update feed URL',
    updateFeedHint:
      'Defaults to GitHub Releases. For intranet use, point this to a mirror; it must start with http:// or https://.',
    updateApplyFeed: 'Apply URL',
    updateCurrent: 'Current version {{version}}',
    updateCheck: 'Check for updates',
    updateChecking: 'Checking…',
    updateNotChecked: 'Not checked yet',
    updateIdle: 'You are up to date',
    updateAvailable: 'Version {{version}} is available',
    updateDownload: 'Download and install',
    updateDownloading: 'Downloading {{percent}}%',
    updateDownloaded: 'Version {{version}} downloaded',
    updateRestart: 'Restart and install',
    updateLater: 'Later',
    updateAvailableBadge: 'Update {{version}} available',
    updateReadyBadge: 'Restart to update',
    updateAvailableTitle: 'Version {{version}} is available',
    updateAvailableBody:
      'Download and install the new version; you will be asked before restarting.',
    updateReadyTitle: 'Update ready',
    updateReadyBody:
      'Version {{version}} has been downloaded. Restart now or it will install when you quit.',
    updateFailed: 'Update check failed. Check your network or feed URL.',
    updateDevMode: 'Update checks are disabled in development mode',
    updateFeedInvalid: 'Invalid feed URL; it must start with http:// or https://',
    updateFeedBusy: 'An update is in progress; please try again shortly.',
```

**Step 3: 扩展 SettingsPanel**

修改 `apps/renderer/src/components/panels/SettingsPanel.tsx`：

1. 导入改为：

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Progress, Radio, Select, Switch } from 'antd';
import { supportedLocales } from '@fireeyeaud/shared/locales';
import { useSettingsStore } from '../../store/settings';
import { useUpdatesStore } from '../../store/updates';
import { useUiStore } from '../../store/ui';
import { FormActions } from '../forms/FormActions';
```

2. 在组件内、现有 `const closeTab = ...` 之后加入：

```tsx
  const update = useUpdatesStore();
  const [feedDraft, setFeedDraft] = useState(update.feedUrl);
  const [feedError, setFeedError] = useState<'invalid_url' | 'busy' | null>(null);

  useEffect(() => {
    setFeedDraft(update.feedUrl);
  }, [update.feedUrl]);

  const applyFeed = async () => {
    const result = await update.setFeedUrl(feedDraft);
    setFeedError(
      result.ok ? null : result.error === 'busy' ? 'busy' : 'invalid_url',
    );
  };

  const statusText =
    update.error === 'dev_mode'
      ? t('updateDevMode')
      : update.error
        ? t('updateFailed')
        : update.phase === 'checking'
          ? t('updateChecking')
          : update.phase === 'available'
            ? t('updateAvailable', { version: update.availableVersion ?? '' })
            : update.phase === 'downloading'
              ? t('updateDownloading', { percent: update.percent })
              : update.phase === 'downloaded'
                ? t('updateDownloaded', { version: update.availableVersion ?? '' })
                : update.phase === 'not-available'
                  ? t('updateIdle')
                  : t('updateNotChecked');
```

说明：`invalid_input`（例如 `setEnabled` 收到非布尔值）会落入 `update.error` 的通用分支，
显示 `updateFailed`，无需新增文案；正常 UI 只会传布尔值，该代码主要用于防御异常调用。

3. 在 `FormActions` 之前插入更新区块：

```tsx
      <div className="field">
        <span className="field__label">{t('updateSection')}</span>
        <label className="field field--inline">
          <Switch
            checked={update.enabled}
            onChange={(value) => void update.setEnabled(value)}
          />
          <span>{t('autoUpdateEnabled')}</span>
        </label>
        <span className="card__meta">{t('updateFeedHint')}</span>
      </div>
      <label className="field">
        <span className="field__label">{t('updateFeed')}</span>
        <input
          className="searchbox"
          value={feedDraft}
          onChange={(event) => setFeedDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void applyFeed();
          }}
        />
      </label>
      {feedError && (
        <span className="card__meta">
          {t(feedError === 'busy' ? 'updateFeedBusy' : 'updateFeedInvalid')}
        </span>
      )}
      <span className="card__meta">
        {t('updateCurrent', { version: update.currentVersion || '—' })}
      </span>
      <span className="card__meta">{statusText}</span>
      {update.phase === 'downloading' && (
        <Progress percent={update.percent} size="small" status="active" />
      )}
      <div className="field field--inline">
        <Button
          onClick={() => void applyFeed()}
          disabled={
            update.phase === 'checking' ||
            update.phase === 'downloading' ||
            update.phase === 'downloaded'
          }
        >
          {t('updateApplyFeed')}
        </Button>
        <Button
          onClick={() => void update.check()}
          loading={update.phase === 'checking'}
          disabled={update.phase === 'downloading'}
        >
          {t('updateCheck')}
        </Button>
        {update.phase === 'available' && (
          <Button type="primary" onClick={() => void update.download()}>
            {t('updateDownload')}
          </Button>
        )}
        {update.phase === 'downloaded' && (
          <Button type="primary" onClick={() => void update.install()}>
            {t('updateRestart')}
          </Button>
        )}
      </div>
```

**Step 4: 类型检查**

Run:

```powershell
npm run renderer:typecheck
```

Expected: PASS。

**Step 5: Commit**

```powershell
git add apps/renderer/src/components/panels/SettingsPanel.tsx packages/shared/src/locales/zh-CN.ts packages/shared/src/locales/en-US.ts
git commit -m "feat(update): add update controls to settings panel"
```

---

### Task 7: 状态栏徽标与非模态通知

**Files:**
- Modify: `apps/renderer/src/components/StatusBar.tsx`
- Modify: `apps/renderer/src/App.tsx`
- Modify: `apps/renderer/src/styles/global.css:3151-3156`（`.statusbar__item` 之后）
- Create: `apps/renderer/src/components/UpdateNotifier.tsx`

**Step 1: 创建通知组件**

创建 `apps/renderer/src/components/UpdateNotifier.tsx`：

```tsx
import { useEffect, useRef } from 'react';
import { Button, notification } from 'antd';
import { useTranslation } from 'react-i18next';
import { useUpdatesStore } from '../store/updates';

/**
 * 发现新版本 / 下载完成时弹非模态通知；同一版本只提示一次。
 * 关闭通知不会中断下载，状态仍可在设置与状态栏查看。
 */
export function UpdateNotifier() {
  const { t } = useTranslation('settings');
  const phase = useUpdatesStore((s) => s.phase);
  const version = useUpdatesStore((s) => s.availableVersion);
  const download = useUpdatesStore((s) => s.download);
  const install = useUpdatesStore((s) => s.install);
  const last = useRef('');

  useEffect(() => {
    if (phase === 'available' && last.current !== `available:${version}`) {
      last.current = `available:${version}`;
      const key = `update-available-${version}`;
      notification.info({
        key,
        message: t('updateAvailableTitle', { version }),
        description: t('updateAvailableBody'),
        duration: 0,
        btn: (
          <Button
            type="primary"
            size="small"
            onClick={() => {
              notification.destroy(key);
              void download();
            }}
          >
            {t('updateDownload')}
          </Button>
        ),
      });
    }

    if (phase === 'downloaded' && last.current !== `downloaded:${version}`) {
      last.current = `downloaded:${version}`;
      const key = `update-ready-${version}`;
      notification.success({
        key,
        message: t('updateReadyTitle'),
        description: t('updateReadyBody', { version }),
        duration: 0,
        btn: (
          <Button
            type="primary"
            size="small"
            onClick={() => {
              notification.destroy(key);
              void install();
            }}
          >
            {t('updateRestart')}
          </Button>
        ),
      });
    }
  }, [phase, version, download, install, t]);

  return null;
}
```

**Step 2: 挂载通知组件**

在 `apps/renderer/src/App.tsx` 中：

1. 导入：

```tsx
import { UpdateNotifier } from './components/UpdateNotifier';
```

2. 在根 `<div className="app">` 内、`<WorkspaceWatcher />` 附近加入：

```tsx
      <UpdateNotifier />
```

**Step 3: 状态栏徽标**

修改 `apps/renderer/src/components/StatusBar.tsx`：

1. 新增导入：

```tsx
import { useUpdatesStore } from '../store/updates';
import { useUiStore } from '../store/ui';
```

2. 在组件内加入：

```tsx
  const updatePhase = useUpdatesStore((s) => s.phase);
  const availableVersion = useUpdatesStore((s) => s.availableVersion);
  const openSettings = useUiStore((s) => s.openSettings);
```

3. 在版本号 `<span className="statusbar__item">` 之前加入：

```tsx
        {(updatePhase === 'available' || updatePhase === 'downloaded') && (
          <button
            type="button"
            className="statusbar__item statusbar__item--update"
            onClick={() => void openSettings()}
          >
            {updatePhase === 'downloaded'
              ? t('updateReadyBadge')
              : t('updateAvailableBadge', { version: availableVersion ?? '' })}
          </button>
        )}
```

**Step 4: 补样式**

在 `apps/renderer/src/styles/global.css` 的 `.statusbar__item` 规则之后加入：

```css
.statusbar__item--update {
  border: 0;
  padding: 0;
  background: none;
  color: var(--accent);
  cursor: pointer;
}

.statusbar__item--update:hover {
  text-decoration: underline;
}
```

**Step 5: 类型检查与构建**

Run:

```powershell
npm run renderer:typecheck
npm run renderer:build
```

Expected: 均 PASS。

**Step 6: Commit**

```powershell
git add apps/renderer/src/components/StatusBar.tsx apps/renderer/src/components/UpdateNotifier.tsx apps/renderer/src/App.tsx apps/renderer/src/styles/global.css
git commit -m "feat(update): surface update status in status bar and notifications"
```

---

### Task 8: 发布文档与索引

**Files:**
- Create: `docs/dev/zh/07-updater.md`
- Create: `docs/dev/en/07-updater.md`
- Modify: `docs/dev/zh/README.md`（文档索引表）
- Modify: `docs/dev/en/README.md`（文档索引表）

**Step 1: 写中文文档**

创建 `docs/dev/zh/07-updater.md`：

```markdown
# 自动更新

应用在 Windows 安装版中支持版本监测与静默升级，基于 `electron-updater` 的 generic provider，更新包放在 GitHub Releases。

## 行为

- 设置 → 版本更新中可开关「启动时自动检查更新」，默认开启。
- 开关打开时，应用启动后约 9 秒检查一次；关闭后不再自动检查，但仍可在设置中手动点「检查更新」。
- 发现新版本只提示，不自动下载；用户确认后下载，下载完成提示「立即重启安装 / 稍后」。
- 选择「稍后」后，下次正常退出应用时会静默安装并自动重启；安装前会先停止 Python sidecar。
- 开发模式（`npm run dev`）和 `release/win-unpacked` 直接运行不检查更新。

## 配置

配置文件：`%APPDATA%\fireeyeaud\update-settings.json`

```json
{
  "enabled": true,
  "feedUrl": "https://github.com/txboy/fireeyeaud/releases/latest/download/"
}
```

`feedUrl` 必须以 `/` 结尾、只接受 http(s)，可在设置界面修改。内网部署时把它指向镜像目录，镜像需提供 `latest.yml`、安装包和 `.blockmap`。配置文件采用临时文件 + rename 的原子替换，避免留下写坏的 JSON；不做 fsync，极端断电时可能丢失最后一次偏好变更，对开关类配置可接受。

## 发布新版本

1. 修改 `apps/desktop/package.json` 的 `version`（例如 `0.1.1`）。
2. 构建安装包：

   ```powershell
   npm run dist -w @fireeyeaud/desktop
   ```

   产物在 `apps/desktop/release/`：安装包、`.blockmap`、`latest.yml`。
3. 在 GitHub 创建 tag `v0.1.1` 的 Release（不要存为 draft），上传安装包、`.blockmap`、`latest.yml` 三个文件。
4. 已安装旧版本的用户下次启动时会看到更新提示。

采用 generic provider 时 electron-builder 不会自动上传（`--publish always` 对 generic provider 不生效），保持默认的 `--publish never`；构建完成后手动把安装包、`.blockmap`、`latest.yml` 上传到 GitHub Release。

## 注意

- `releases/latest` 按 Release 的创建时间取最新，不比较版本号；发布多个版本时务必最后创建最新 semver 的 Release，确保 `latest/download` 指向它。
- `latest.yml` 中的版本必须高于已安装版本，否则不会提示。
- 安装包未做代码签名时，Windows SmartScreen 可能对下载的安装包给出警告；正式分发建议补签名。
- 更新源默认在 GitHub，国内网络可能较慢，可改为内网镜像地址。
- 不支持便携版、`win-unpacked` 直接运行或非 NSIS 安装方式。
```

**Step 2: 写英文文档**

创建 `docs/dev/en/07-updater.md`，内容与中文版对应即可，至少覆盖行为、配置、发布步骤和注意事项。

**Step 3: 更新文档索引**

在 `docs/dev/zh/README.md` 的「先读哪份」表格末尾加入：

```markdown
| 发布新版本、排查自动更新 | [自动更新](07-updater.md) |
```

在 `docs/dev/en/README.md` 对应表格末尾加入：

```markdown
| Release a new version or debug auto-update | [Auto update](07-updater.md) |
```

**Step 4: Commit**

```powershell
git add docs/dev/zh/07-updater.md docs/dev/en/07-updater.md docs/dev/zh/README.md docs/dev/en/README.md
git commit -m "docs(update): document release and auto-update flow"
```

---

### Task 9: 全量验证与端到端验收

**Files:**
- 无新增文件；只做验证与必要修复。

**Step 1: 静态检查与单测**

Run:

```powershell
npm run desktop:test
npm run renderer:typecheck
npm run renderer:build
```

Expected:

- `desktop:test`：除本机缺 `uvicorn` 导致的 2 个 sidecar 环境用例外全部通过；其中
  `updater.test.mjs` 36/36、`quit-flow.test.mjs` 7/7。
- `renderer:typecheck`：无输出、退出码 0。
- `renderer:build`：生成 `apps/renderer/dist/`，退出码 0。

**Step 2: 打包**

Run:

```powershell
npm run dist -w @fireeyeaud/desktop
```

Expected: `apps/desktop/release/` 下生成安装包、`.exe.blockmap`、`latest.yml`。检查 `latest.yml` 中的 `version` 与 `apps/desktop/package.json` 一致。

**Step 3: 端到端验收（需要 GitHub Release 或本地 HTTP 镜像）**

1. 安装当前 `0.1.0` 安装包。
2. 把 `feedUrl` 指向一个包含更高版本 `latest.yml`、安装包、`.blockmap` 的目录（本地可用 `python -m http.server` 模拟）。
3. 启动应用，等待约 9 秒，确认：
   - 状态栏出现「有新版本 vX.Y.Z」；
   - 右上角出现非模态通知；
   - 设置 → 版本更新显示可用版本。
4. 点「下载并安装」，确认进度更新，完成后提示「新版本已就绪」。
5. 选择「稍后」，关闭应用；确认安装器运行、应用自动以新版本重启，状态栏版本号变化。
6. 重复到下载完成，选「立即重启安装」，确认同样升级成功。
7. 关闭自动检查开关，重启应用，确认不再自动检查；手动点「检查更新」仍可用。
8. 把 `feedUrl` 改成不可达地址，手动检查，确认显示失败文案且应用不崩溃。
9. 在 `npm run dev` 下点「检查更新」，确认显示「开发模式不检查更新」。

**Step 4: 检查副作用**

- 确认升级后 `%APPDATA%\fireeyeaud\` 下的设置、日志、`update-settings.json` 仍在。
- 确认升级前 sidecar 正常退出（日志无 `[sidecar] stop failed`），升级后 sidecar 正常启动。
- 确认工作区 `.fireeye/` 数据未被触碰。

**Step 5: Commit（如有修复）**

```powershell
git add -A
git commit -m "fix(update): address issues found in end-to-end verification"
```

---

## 风险与边界

- **GitHub 可达性**：默认源在 GitHub，国内可能慢或不通；`feedUrl` 可改内网镜像。检查失败只提示，不阻塞应用。
- **代码签名**：未签名的 NSIS 安装包可能触发 SmartScreen；不影响 electron-updater 的静默安装，但正式分发前建议签名。
- **安装目录权限**：当前 NSIS 为默认的 per-user 一键安装，无需管理员权限；若未来改 `perMachine`，安装更新会需要提权。
- **退出流程**：`before-quit` 必须保证 sidecar 先停；已用 `quit-flow.cjs` 实现 5s
  sidecar 停止超时与 5s 安装看门狗兜底，避免退出被永久卡住。重复退出请求会被拦截，
  只有 sidecar 停完并调用 `quitAndInstall()` 后才放行。
- **不做**：macOS/Linux 更新、灰度/分批、强制更新、版本回滚、 prerelease 通道、下载断点续传之外的定制策略。
