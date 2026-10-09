'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const { SidecarManager, pythonExeFor } = require('./sidecar.cjs');
const { loadWindowState, saveWindowState } = require('./window-state.cjs');

app.setName('fireeyeaud');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
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
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));

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

  // 加载页的 CSP：只允许同源与本地 sidecar 连接。
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
