'use strict';

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  session,
  shell,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const { SidecarManager, pythonExeFor, bundledAgentExe } = require('./sidecar.cjs');
const { createSecretsStore } = require('./secrets.cjs');
const { loadWindowState, saveWindowState } = require('./window-state.cjs');
const { readFileContent, writeTextFile, deletePath } = require('./file-preview.cjs');
const { copyInto, move, createDir, createFile, rename } = require('./file-ops.cjs');
const { parseTokens, isExcluded, isIncluded } = require('./search-tokens.cjs');

app.setName('fireeyeaud');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEV_SERVER_URL = process.env.FIREEYEAUD_DEV_SERVER_URL;
const RENDERER_DIST = path.join(REPO_ROOT, 'apps', 'renderer', 'dist', 'index.html');
const APP_ICON = path.join(__dirname, '..', 'build', 'icon.png');
const SIDECAR_TOKEN = crypto.randomBytes(24).toString('hex');

let mainWindow = null;
let quitting = false;
let secrets = null;

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

// ---- 工作区文件监听（外部增删改文件 → 去抖通知渲染层触发数据源对账）----
let workspaceWatcher = null;
let workspaceWatchTimer = null;

function stopWorkspaceWatch() {
  if (workspaceWatcher) {
    try {
      workspaceWatcher.close();
    } catch {
      /* 忽略关闭失败 */
    }
    workspaceWatcher = null;
  }
  if (workspaceWatchTimer) {
    clearTimeout(workspaceWatchTimer);
    workspaceWatchTimer = null;
  }
}

function startWorkspaceWatch(root) {
  stopWorkspaceWatch();
  if (typeof root !== 'string' || !root) return;
  try {
    workspaceWatcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      const name = filename ? String(filename) : '';
      // 忽略 .fireeye 内部写入（workspace.duckdb / 索引），否则导入会触发监听风暴。
      if (name.split(/[\\/]/)[0] === '.fireeye') return;
      if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer);
      workspaceWatchTimer = setTimeout(() => {
        workspaceWatchTimer = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('workspace:fs-changed');
        }
      }, 1200);
    });
  } catch (err) {
    logger.error(`[watch] failed to watch ${root}: ${err}`);
    workspaceWatcher = null;
  }
}

const BUNDLED_AGENT = bundledAgentExe();
const sidecar = new SidecarManager({
  repoRoot: REPO_ROOT,
  token: SIDECAR_TOKEN,
  pythonExe: pythonExeFor(REPO_ROOT),
  agentExe: BUNDLED_AGENT,
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
    frame: false,
    backgroundColor: '#1E1F22',
    title: '火眼审计助手',
    ...(fs.existsSync(APP_ICON) ? { icon: APP_ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', () => saveWindowState(app.getPath('userData'), mainWindow.getBounds()));

  // 无边框窗口：把最大化状态变化通知渲染层，用于切换「最大化/还原」图标。
  const sendMaximized = () =>
    mainWindow?.webContents.send('window:maximized', mainWindow.isMaximized());
  mainWindow.on('maximize', sendMaximized);
  mainWindow.on('unmaximize', sendMaximized);

  // 无菜单栏后，开发态保留 F12 / Ctrl+Shift+I 打开 DevTools。
  if (DEV_SERVER_URL) {
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      const isToggle =
        input.type === 'keyDown' &&
        (input.key === 'F12' ||
          (input.control && input.shift && input.key.toLowerCase() === 'i'));
      if (isToggle) mainWindow.webContents.toggleDevTools();
    });
  }

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

/** 把主进程内存中的全部明文凭据推送给 sidecar（仅内存持有）。 */
async function pushSecretsToSidecar(info = sidecar.getInfo()) {
  if (!secrets || !info || info.status !== 'running' || !info.port) return;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/v1/secrets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(info.token ? { Authorization: `Bearer ${info.token}` } : {}),
      },
      body: JSON.stringify({ items: secrets.all() }),
    });
    if (!res.ok) logger.error(`[secrets] push status ${res.status}`);
  } catch (err) {
    logger.error(`[secrets] push failed: ${err}`);
  }
}

function registerIpc() {
  ipcMain.handle('sidecar:info', () => sidecar.getInfo());
  ipcMain.handle('app:info', () => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    userData: app.getPath('userData'),
  }));
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });
  ipcMain.handle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()));
  ipcMain.handle('dialog:open-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: '打开工作区文件夹',
      properties: ['openDirectory'],
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });
  ipcMain.handle('dialog:open-files', async (_event, kind, options) => {
    const DB_EXT = {
      sqlite: ['db', 'sqlite', 'sqlite3', 'db3', 's3db', 'sl3'],
      access: ['mdb', 'accdb'],
    };
    let filters;
    let title;
    let properties = ['openFile', 'multiSelections'];
    if (kind === 'templates') {
      filters = [{ name: 'Word 模板', extensions: ['docx'] }];
      title = '选择 docx 模板';
    } else if (kind === 'attachments') {
      filters = [
        {
          name: '支持的附件',
          extensions: [
            'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml',
            'yaml', 'yml', 'ini', 'conf', 'sql', 'py', 'js', 'ts',
            'xlsx', 'xlsm', 'docx', 'pdf',
          ],
        },
        { name: '所有文件', extensions: ['*'] },
      ];
      title = '选择附件文件';
    } else if (kind === 'database') {
      // 按驱动过滤：SQLite 与 Access 扩展名不同，单选。
      const driver = options?.driver === 'access' ? 'access' : 'sqlite';
      filters = [
        {
          name: driver === 'access' ? 'Access 数据库' : 'SQLite 数据库',
          extensions: DB_EXT[driver],
        },
        { name: '所有文件', extensions: ['*'] },
      ];
      title = '选择数据库文件';
      properties = ['openFile'];
    } else {
      filters = [
        { name: '所有文件', extensions: ['*'] },
        { name: '数据文件', extensions: ['xlsx', 'xlsm', 'csv', 'txt'] },
      ];
      title = kind === 'all' ? '选择文件' : '选择数据文件';
    }
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title,
      filters,
      properties,
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('search:run', (_event, payload) => {
    const { root, query, options } = payload ?? {};
    return runSearch(root, query, options ?? {});
  });
  ipcMain.handle('fs:read-dir', (_event, payload) => {
    const { root, dir } = payload ?? {};
    if (typeof root !== 'string' || typeof dir !== 'string') return { entries: [] };
    const rootAbs = path.resolve(root);
    const dirAbs = path.resolve(dir);
    const rel = path.relative(rootAbs, dirAbs);
    // 仅允许工作区根目录及其子目录。
    if (rel.startsWith('..') || path.isAbsolute(rel)) return { entries: [] };
    let dirents;
    try {
      dirents = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return { entries: [] };
    }
    const entries = dirents
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => {
        const abs = path.join(dirAbs, entry.name);
        let size;
        if (entry.isFile()) {
          try {
            size = fs.statSync(abs).size;
          } catch {
            /* ignore */
          }
        }
        return { name: entry.name, path: abs, isDir: entry.isDirectory(), size };
      })
      .sort((a, b) =>
        a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
      )
      .slice(0, SEARCH_MAX_TOTAL);
    return { entries };
  });
  ipcMain.handle('fs:read-file', (_event, payload) => {
    const { root, path: filePath } = payload ?? {};
    if (typeof root !== 'string' || typeof filePath !== 'string') {
      return { ok: false, code: 'E_NOT_FOUND' };
    }
    return readFileContent({ root, filePath });
  });
  ipcMain.handle('fs:write-text-file', (_event, payload) => {
    const { root, path: filePath, text } = payload ?? {};
    if (typeof root !== 'string' || typeof filePath !== 'string') {
      return { ok: false, code: 'E_WRITE_FAILED' };
    }
    return writeTextFile({ root, filePath, text });
  });
  ipcMain.handle('fs:delete', (_event, payload) => {
    const { root, path: filePath } = payload ?? {};
    if (typeof root !== 'string' || typeof filePath !== 'string') {
      return { ok: false, code: 'E_DELETE_FAILED' };
    }
    return deletePath({ root, filePath });
  });
  ipcMain.handle('fs:copy-files', (_event, payload) => {
    const { root, targetDir, sourcePaths } = payload ?? {};
    if (typeof root !== 'string' || typeof targetDir !== 'string') {
      return { ok: false, code: 'E_OP_FAILED' };
    }
    return copyInto({ root, targetDir, sourcePaths });
  });
  ipcMain.handle('fs:move', (_event, payload) => {
    const { root, sourcePath, targetDir } = payload ?? {};
    if (typeof root !== 'string') return { ok: false, code: 'E_OP_FAILED' };
    return move({ root, sourcePath, targetDir });
  });
  ipcMain.handle('fs:create-dir', (_event, payload) => {
    const { root, parentDir, name } = payload ?? {};
    if (typeof root !== 'string') return { ok: false, code: 'E_OP_FAILED' };
    return createDir({ root, parentDir, name });
  });
  ipcMain.handle('fs:create-file', (_event, payload) => {
    const { root, parentDir, name } = payload ?? {};
    if (typeof root !== 'string') return { ok: false, code: 'E_OP_FAILED' };
    return createFile({ root, parentDir, name });
  });
  ipcMain.handle('fs:rename', (_event, payload) => {
    const { root, path: filePath, newName } = payload ?? {};
    if (typeof root !== 'string') return { ok: false, code: 'E_OP_FAILED' };
    return rename({ root, filePath, newName });
  });
  ipcMain.handle('shell:open-path', (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return { ok: false };
    return shell.openPath(filePath).then((err) => ({ ok: !err }));
  });
  ipcMain.handle('shell:show-item', (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return { ok: false };
    shell.showItemInFolder(filePath);
    return { ok: true };
  });
  ipcMain.handle('shell:open-external', (_event, url) => {
    if (typeof url !== 'string') return { ok: false };
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false };
    }
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return { ok: false };
    shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle('workspace:watch', (_event, root) => {
    startWorkspaceWatch(root);
    return { ok: true };
  });
  ipcMain.handle('workspace:unwatch', () => {
    stopWorkspaceWatch();
    return { ok: true };
  });
  ipcMain.handle('secret:put', async (_event, plaintext) => {
    if (typeof plaintext !== 'string' || !plaintext) return null;
    const ref = secrets.put(plaintext);
    await pushSecretsToSidecar();
    return ref;
  });
  ipcMain.handle('secret:delete', async (_event, ref) => {
    if (typeof ref === 'string' && ref) secrets.remove(ref);
    await pushSecretsToSidecar();
    return { ok: true };
  });
  ipcMain.handle('secret:refs', () => (secrets ? secrets.refs() : []));
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
  secrets = createSecretsStore({
    dir: app.getPath('userData'),
    safeStorage,
    logger,
  });
  registerIpc();
  hardenWebContents();

  // 移除系统菜单栏（File/Edit/View/Window…）；窗口为无边框自绘标题栏。
  Menu.setApplicationMenu(null);

  // CSP：仅在生产（非 dev server）注入，避免影响 Vite HMR。
  if (!DEV_SERVER_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; connect-src 'self' http://127.0.0.1:*; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; font-src 'self' data: blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
          ],
        },
      });
    });
  }

  sidecar.onStatus = (info) => {
    broadcastStatus(info);
    if (info.status === 'running') void pushSecretsToSidecar(info);
  };
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
  stopWorkspaceWatch();
  sidecar
    .stop()
    .catch((err) => logger.error(`[sidecar] stop failed: ${err}`))
    .finally(() => app.exit(0));
});
