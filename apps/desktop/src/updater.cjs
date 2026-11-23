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

  let pendingAction = 'check';

  function onError(err) {
    logger.error(`[update] ${err?.stack || err}`);
    publish({
      phase: 'error',
      error: pendingAction === 'download' ? 'download_failed' : 'check_failed',
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
    publish({ phase: 'checking', error: null }),
  );
  autoUpdater.on('update-available', (info) =>
    publish({
      phase: 'available',
      availableVersion: info?.version ?? null,
      error: null,
    }),
  );
  autoUpdater.on('update-not-available', () =>
    publish({
      phase: 'not-available',
      availableVersion: null,
      percent: 0,
      error: null,
    }),
  );
  autoUpdater.on('download-progress', (progress) =>
    publish({
      phase: 'downloading',
      percent: Math.round(progress?.percent ?? 0),
      bytesPerSecond: progress?.bytesPerSecond ?? 0,
    }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    publish({
      phase: 'downloaded',
      availableVersion: info?.version ?? state.availableVersion,
      percent: 100,
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
    pendingAction = 'check';
    applyFeed();
    publish({ phase: 'checking', error: null });
    try {
      const result = autoUpdater.checkForUpdates();
      if (result && typeof result.catch === 'function') result.catch(onError);
    } catch (err) {
      onError(err);
    }
    return { ...state };
  }

  function setEnabled(enabled) {
    const result = prefs.set({ enabled: Boolean(enabled) });
    if (!result.ok) {
      return { ok: false, error: result.error, state: { ...state } };
    }
    return { ok: true, state: publish({ enabled: result.settings.enabled }) };
  }

  function setFeedUrl(feedUrl) {
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
        error: null,
      }),
    };
  }

  function download() {
    if (!state.availableVersion) {
      return { ok: false, error: 'not_available' };
    }
    if (state.phase === 'downloading' || state.phase === 'downloaded') {
      return { ok: false, error: 'busy' };
    }
    pendingAction = 'download';
    publish({ phase: 'downloading', percent: 0, error: null });
    try {
      const result = autoUpdater.downloadUpdate();
      if (result && typeof result.catch === 'function') result.catch(onError);
    } catch (err) {
      onError(err);
      return { ok: false, error: 'download_failed' };
    }
    return { ok: true };
  }

  function isUpdateReady() {
    return state.phase === 'downloaded';
  }

  function quitAndInstall() {
    if (!isUpdateReady()) return false;
    autoUpdater.quitAndInstall(true, true);
    return true;
  }

  function start() {
    if (!isPackaged || !state.enabled) return;
    schedule(() => check(), startupDelayMs);
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

module.exports = {
  DEFAULT_FEED_URL,
  PREFS_FILE,
  STARTUP_DELAY_MS,
  normalizeFeedUrl,
  createUpdatePrefsStore,
  createUpdater,
};
