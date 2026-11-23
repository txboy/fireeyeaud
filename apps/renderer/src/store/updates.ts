import { create } from 'zustand';
import type { UpdateErrorCode, UpdateResult, UpdateState } from '@fireeyeaud/shared';

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

/** 主进程通过 preload 暴露的更新接口；工厂依赖它以便单测注入。 */
export interface UpdatesBridge {
  getState: () => Promise<UpdateState | null>;
  setEnabled: (enabled: boolean) => Promise<UpdateResult>;
  setFeedUrl: (url: string) => Promise<UpdateResult>;
  check: () => Promise<UpdateResult>;
  download: () => Promise<UpdateResult>;
  install: () => Promise<UpdateResult>;
  onState: (callback: (state: UpdateState) => void) => () => void;
}

interface UpdatesStore extends UpdateState {
  init: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<{ ok: boolean; error?: UpdateErrorCode }>;
  setFeedUrl: (feedUrl: string) => Promise<{ ok: boolean; error?: UpdateErrorCode }>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
}

/** 主进程负责检查/下载；这里只镜像状态并转发命令。 */
export function createUpdatesStore(api: UpdatesBridge | undefined) {
  let subscribed = false;
  let unsubscribe: (() => void) | null = null;

  const store = create<UpdatesStore>((set) => {
    /** 统一吞掉 IPC 拒绝并镜像成功返回的状态。 */
    const apply = async (call: () => Promise<UpdateResult>) => {
      try {
        const result = await call();
        if (result?.state) set(result.state);
        return result;
      } catch (err) {
        console.error('[update] update command failed', err);
        return null;
      }
    };

    return {
      ...initialState,

      init: async () => {
        if (!api || subscribed) return;
        subscribed = true;
        let eventSeen = false;
        // 先订阅再取快照：期间的推送会置位 eventSeen，避免旧快照覆盖新事件。
        unsubscribe = api.onState((next) => {
          eventSeen = true;
          set(next);
        });
        try {
          const state = await api.getState();
          if (state && !eventSeen) set(state);
        } catch (err) {
          console.error('[update] failed to read update state', err);
          unsubscribe?.();
          unsubscribe = null;
          subscribed = false;
        }
      },

      setEnabled: async (enabled) => {
        if (!api) return { ok: false };
        const result = await apply(() => api.setEnabled(enabled));
        return { ok: Boolean(result?.ok), error: result?.error };
      },

      setFeedUrl: async (feedUrl) => {
        if (!api) return { ok: false };
        const result = await apply(() => api.setFeedUrl(feedUrl));
        return { ok: Boolean(result?.ok), error: result?.error };
      },

      check: async () => {
        if (!api) return;
        await apply(() => api.check());
      },

      download: async () => {
        if (!api) return;
        await apply(() => api.download());
      },

      install: async () => {
        if (!api) return;
        await apply(() => api.install());
      },
    };
  });

  // HMR 替换模块时释放旧监听，避免同一渲染进程里累积订阅。
  if (typeof import.meta.hot?.dispose === 'function') {
    import.meta.hot.dispose(() => {
      unsubscribe?.();
      unsubscribe = null;
      subscribed = false;
    });
  }

  return store;
}

export const useUpdatesStore = createUpdatesStore(
  typeof window === 'undefined' ? undefined : window.fireeyeaud?.updates,
);
