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
