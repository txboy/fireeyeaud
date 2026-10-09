'use strict';

const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const { SidecarManager, pythonExeFor } = require('./sidecar.cjs');
const { loadWindowState, saveWindowState } = require('./window-state.cjs');

app.setName('fireeyeaud');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEV_SERVER_URL = process.env.FIREEYEAUD_DEV_SERVER_URL;
const RENDERER_DIST = path.join(REPO_ROOT, 'apps', 'renderer', 'dist', 'index.html');
const SIDECAR_TOKEN = crypto.randomBytes(24).toString('hex');

let mainWindow = null;
let quitting = false;

function createLogger() {
  const dir = path.join(app.getPath('userData'), 'logs');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  const file = path.join(dir, `agent-${new Date().toISOString().slice(0, 10)}.log`);
  const stream = fs.createWriteStream(file, { flags: 'a' });
  const write = (level, args) => {
    const line = `[${new Date().toISOString()}] [${level}] ${args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')}`;
    stream.write(`${line}\n`);
    if (level === 'error') console.error(line);
    else console.log(line);
  };
  return { info: (...a) => write('info', a), error: (...a) => write('error', a) };
}

const logger = createLogger();
const sidecar = new SidecarManager({
  repoRoot: REPO_ROOT,
  token: SIDECAR_TOKEN,
  pythonExe: pythonExeFor(REPO_ROOT),
  logger,
});

function createWindow() {
  const state = loadWindowState(app.getPath('userData'));

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#1E1F22',
    title: '火眼审计助手',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', () => saveWindowState(app.getPath('userData'), mainWindow.getBounds()));

  mainWindow.webContents.on('did-finish-load', () =>
    logger.info(`[renderer] loaded ${mainWindow.webContents.getURL()}`),
  );
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) =>
    logger.error(`[renderer] did-fail-load ${code} ${desc} ${url}`),
  );
  mainWindow.webContents.on('render-process-gone', (_e, details) =>
    logger.error(`[renderer] process gone ${JSON.stringify(details)}`),
  );
  mainWindow.webContents.on('console-message', (...args) => {
    const detail = args[1];
    const text = typeof detail === 'object' && detail ? detail.message : args[2];
    logger.info(`[renderer] ${text}`);
  });

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else if (fs.existsSync(RENDERER_DIST)) {
    mainWindow.loadFile(RENDERER_DIST);
  } else {
    // 渲染层尚未构建时的自检回退页。
    mainWindow.loadFile(path.join(__dirname, 'loading.html'));
  }

  return mainWindow;
}

function broadcastStatus(info) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sidecar:status', info);
  }
}

function registerIpc() {
  ipcMain.handle('sidecar:info', () => sidecar.getInfo());
  ipcMain.handle('app:info', () => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    userData: app.getPath('userData'),
  }));
  ipcMain.handle('dialog:open-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: '打开工作区文件夹',
      properties: ['openDirectory'],
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });
  ipcMain.handle('dialog:open-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: '选择数据文件',
      filters: [{ name: '表格', extensions: ['xlsx', 'xlsm', 'csv'] }],
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('search:run', (_event, payload) => {
    const { root, query, options } = payload ?? {};
    return runSearch(root, query, options ?? {});
  });
}

const SEARCH_SKIP_DIRS = new Set([
  '.fireeye',
  'node_modules',
  '.git',
  'dist',
  'build',
  '.cache',
]);
const SEARCH_BINARY_EXT = new Set([
  '.xlsx',
  '.xlsm',
  '.xls',
  '.duckdb',
  '.sqlite',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.woff',
  '.woff2',
  '.ttf',
  '.exe',
  '.dll',
  '.so',
]);
const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024;
const SEARCH_MAX_PER_FILE = 200;
const SEARCH_MAX_TOTAL = 2000;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSearchRegex(query, options) {
  let pattern = options.regex ? query : escapeRegExp(query);
  if (options.wholeWord) pattern = `\\b${pattern}\\b`;
  return new RegExp(pattern, options.caseSensitive ? 'g' : 'gi');
}

function parseTokens(value) {
  return String(value ?? '')
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function tokenMatches(relPath, token) {
  const clean = token.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^[\\/]+/, '');
  if (!clean) return false;
  return relPath.toLowerCase().includes(clean.toLowerCase());
}

function isExcluded(relPath, tokens) {
  return tokens.some((token) => tokenMatches(relPath, token));
}

function isIncluded(relPath, tokens) {
  if (tokens.length === 0) return true;
  return tokens.some((token) => tokenMatches(relPath, token));
}

function searchFile(absPath, relPath, regex) {
  const stat = fs.statSync(absPath);
  if (stat.size > SEARCH_MAX_FILE_BYTES) return null;
  let content;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  const matches = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    regex.lastIndex = 0;
    const m = regex.exec(lines[i]);
    if (m) {
      matches.push({ line: i + 1, column: m.index + 1, text: lines[i].trim().slice(0, 240) });
      if (matches.length >= SEARCH_MAX_PER_FILE) break;
    }
  }
  return matches.length > 0 ? { path: relPath, matches } : null;
}

function walkSearch(root, regex, includeTokens, excludeTokens, state) {
  const stack = [''];
  while (stack.length > 0 && state.total < SEARCH_MAX_TOTAL) {
    const rel = stack.pop();
    const abs = path.join(root, rel);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SEARCH_SKIP_DIRS.has(entry.name)) continue;
        stack.push(childRel);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SEARCH_BINARY_EXT.has(ext)) continue;
        if (!isIncluded(childRel, includeTokens)) continue;
        if (isExcluded(childRel, excludeTokens)) continue;
        const hit = searchFile(path.join(root, childRel), childRel, regex);
        if (hit) {
          state.files.push(hit);
          state.total += hit.matches.length;
          if (state.total >= SEARCH_MAX_TOTAL) return;
        }
      }
    }
  }
}

function runSearch(root, query, options = {}) {
  if (!root || !query) return { files: [], total: 0 };
  const regex = buildSearchRegex(query, options);
  const state = { files: [], total: 0 };
  walkSearch(
    root,
    regex,
    parseTokens(options.include),
    parseTokens(options.exclude),
    state,
  );
  return state;
}

function hardenWebContents() {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
  });
}

app.whenReady().then(async () => {
  registerIpc();
  hardenWebContents();

  // CSP：仅在生产（非 dev server）注入，避免影响 Vite HMR。
  if (!DEV_SERVER_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; connect-src 'self' http://127.0.0.1:*; style-src 'self' 'unsafe-inline'; script-src 'self'",
          ],
        },
      });
    });
  }

  sidecar.onStatus = broadcastStatus;
  createWindow();

  sidecar
    .start()
    .then((info) => logger.info(`[sidecar] ready on port ${info.port} (${info.status})`))
    .catch((err) => logger.error(`[sidecar] start failed: ${err}`));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  sidecar
    .stop()
    .catch((err) => logger.error(`[sidecar] stop failed: ${err}`))
    .finally(() => app.exit(0));
});
