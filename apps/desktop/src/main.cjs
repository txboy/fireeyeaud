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
