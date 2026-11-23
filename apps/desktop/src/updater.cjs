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
