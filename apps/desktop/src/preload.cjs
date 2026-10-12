'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 仅暴露白名单 API 给渲染进程。
contextBridge.exposeInMainWorld('fireeyeaud', {
  getSidecarInfo: () => ipcRenderer.invoke('sidecar:info'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  openFolder: () => ipcRenderer.invoke('dialog:open-folder'),
  openFiles: (kind) => ipcRenderer.invoke('dialog:open-files', kind),
  searchRun: (payload) => ipcRenderer.invoke('search:run', payload),
  readDir: (payload) => ipcRenderer.invoke('fs:read-dir', payload),
  readFile: (payload) => ipcRenderer.invoke('fs:read-file', payload),
  writeTextFile: (payload) => ipcRenderer.invoke('fs:write-text-file', payload),
  deletePath: (payload) => ipcRenderer.invoke('fs:delete', payload),
  openPath: (filePath) => ipcRenderer.invoke('shell:open-path', filePath),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:show-item', filePath),
  putSecret: (plaintext) => ipcRenderer.invoke('secret:put', plaintext),
  deleteSecret: (ref) => ipcRenderer.invoke('secret:delete', ref),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximized: (callback) => {
    const handler = (_event, maximized) => callback(maximized);
    ipcRenderer.on('window:maximized', handler);
    return () => ipcRenderer.removeListener('window:maximized', handler);
  },
  onSidecarStatus: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('sidecar:status', handler);
    return () => ipcRenderer.removeListener('sidecar:status', handler);
  },
});
