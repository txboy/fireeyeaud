'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 仅暴露白名单 API 给渲染进程。
contextBridge.exposeInMainWorld('fireeyeaud', {
  getSidecarInfo: () => ipcRenderer.invoke('sidecar:info'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  onSidecarStatus: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('sidecar:status', handler);
    return () => ipcRenderer.removeListener('sidecar:status', handler);
  },
});
