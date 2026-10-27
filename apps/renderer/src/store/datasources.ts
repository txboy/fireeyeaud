import { create } from 'zustand';
import type { DataSourceInfo, SseEvent } from '@fireeyeaud/shared';
import {
  deleteDataSource,
  importDataSource,
  listDatasources,
  syncDatasources,
} from '../lib/api';
import { errorKeyOf } from '../lib/errorKey';

export interface ImportState {
  path: string;
  phase: string;
  done: number;
  total: number;
}

/** 一次进行中的对账（前台手动刷新 / 打开工作区的后台准备 / 文件变化触发的增量）。 */
export interface SyncRun {
  full: boolean;
  background: boolean;
  phase: string;
  done: number;
  total: number;
}

export interface SyncOptions {
  full?: boolean;
  /** 后台准备：不阻塞界面，按钮置灰与提示文案都另算。 */
  background?: boolean;
}

/** 对账请求的合并规则：进行中再来的请求不能丢，合并成「跑完后立刻再跑一轮」。 */
export interface QueuedSync {
  full: boolean;
  background: boolean;
  /** 合并后按前台呈现（用户手动点过刷新）；否则仍按后台准备呈现。 */
  foreground: boolean;
  /** Latches: 一旦为 true，即使来源已被后台覆盖也保留。 */
  sawFull?: boolean;
  sawBackground?: boolean;
}

/** 把新请求并入待跑队列（纯函数，便于单测）。 */
export function mergeSyncRequest(
  pending: QueuedSync | null,
  run: SyncRun,
): QueuedSync {
  const sawFull = Boolean(pending?.sawFull || run.full);
  const sawBackground = Boolean(pending?.sawBackground || run.background);
  const hadForeground = Boolean(pending && !pending.background);
  return {
    // 前台手动刷新优先：用户明确点了「重新导入」就要真的全量重导。
    full: sawFull && !hadForeground,
    // 合并后的补跑一律走后台队列：前台按钮只负责触发，不阻塞界面。
    background: true,
    // 同时出现两种来源时按前台处理（用户明确操作 > 自动后台）。
    foreground: hadForeground || Boolean(pending?.foreground) || !run.background,
    sawFull,
    sawBackground,
  };
}

interface DatasourcesState {
  items: DataSourceInfo[];
  importing: ImportState | null;
  /** 前台对账（用户手动刷新）进行中。 */
  syncing: boolean;
  /** 当前前台对账是否为忽略指纹缓存的全量重导。 */
  syncingFull: boolean;
  /** 后台对账（打开工作区准备数据 / 文件变化增量）进行中。 */
  backgroundSync: SyncRun | null;
  /** 合并后的待跑请求：对账进行中来的请求不丢弃，跑完立刻再跑一轮。 */
  pendingSync: QueuedSync | null;
  lastSync: { added: number; removed: number; updated: number } | null;
  /** 导入失败的文件：路径 → 错误码（用于文件树上的失败标识）。 */
  importFailed: Record<string, string>;
  errorKey: string | null;
  load: () => Promise<void>;
  importPath: (path: string) => Promise<void>;
  sync: (options?: SyncOptions) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reset: () => void;
}

export const useDatasourcesStore = create<DatasourcesState>((set, get) => {
  /** 当前正在跑的请求（前台手动刷新或后台准备），没有则 null。 */
  const activeRun = (state: DatasourcesState): SyncRun | null => {
    if (state.backgroundSync) return state.backgroundSync;
    if (state.syncing) return { full: state.syncingFull, background: false, phase: 'sync', done: 0, total: 0 };
    return null;
  };

  /** 串行跑一轮对账；结束后若有合并的待跑请求，立刻再跑一轮。 */
  const runSync = async (run: { full: boolean; background: boolean }): Promise<void> => {
    if (run.background) {
      set({
        backgroundSync: { ...run, phase: 'sync', done: 0, total: 0 },
        errorKey: null,
      });
    } else {
      set({ syncing: true, syncingFull: run.full, errorKey: null });
    }
    try {
      const result = await syncDatasources({
        full: run.full,
        onEvent: (event: SseEvent) => {
          const data = (event.data ?? {}) as Record<string, unknown>;
          if (event.type === 'import_progress') {
            const progress = {
              phase: String(data.phase ?? 'sync'),
              done: Number(data.done ?? 0),
              total: Number(data.total ?? 0),
            };
            set((state) =>
              run.background && state.backgroundSync
                ? { backgroundSync: { ...state.backgroundSync, ...progress } }
                : {},
            );
          } else if (event.type === 'error') {
            set({ errorKey: String(data.messageKey ?? 'error.importParse') });
          }
        },
      });
      set({
        lastSync: {
          added: result.added.length,
          removed: result.removed.length,
          updated: result.updated.length,
        },
        importFailed: (() => {
          const failed: Record<string, string> = {};
          for (const err of result.errors) {
            if (err.path) failed[err.path] = err.code;
          }
          return failed;
        })(),
      });
      await get().load();
    } catch (err) {
      set({
        errorKey: errorKeyOf(err),
      });
    } finally {
      if (run.background) set({ backgroundSync: null });
      else set({ syncing: false, syncingFull: false });
    }

    const pending = get().pendingSync;
    if (pending) {
      set({ pendingSync: null });
      await runSync({
        full: pending.full,
        background: pending.background && !pending.foreground,
      });
    }
  };

  return {
  items: [],
  importing: null,
  syncing: false,
  syncingFull: false,
  backgroundSync: null,
  pendingSync: null,
  lastSync: null,
  importFailed: {},
  errorKey: null,

  load: async () => {
    try {
      const page = await listDatasources();
      set({ items: page.items, errorKey: null });
    } catch (err) {
      set({
        errorKey: errorKeyOf(err),
      });
    }
  },

  importPath: async (path) => {
    set({
      importing: { path, phase: 'parse', done: 0, total: 0 },
      errorKey: null,
    });
    try {
      await importDataSource(path, {
        onEvent: (event: SseEvent) => {
          const data = (event.data ?? {}) as Record<string, unknown>;
          if (event.type === 'import_progress') {
            set({
              importing: {
                path,
                phase: String(data.phase ?? 'parse'),
                done: Number(data.done ?? 0),
                total: Number(data.total ?? 0),
              },
            });
          } else if (event.type === 'error') {
            set((s) => ({
              errorKey: String(data.messageKey ?? 'error.importParse'),
              importFailed: {
                ...s.importFailed,
                [path]: String(data.code ?? 'E_IMPORT_PARSE'),
              },
            }));
          } else if (event.type === 'done') {
            set((s) => {
              if (!(path in s.importFailed)) return {};
              const next = { ...s.importFailed };
              delete next[path];
              return { importFailed: next };
            });
          }
        },
      });
    } catch (err) {
      set({
        errorKey: errorKeyOf(err),
      });
    }
    set({ importing: null });
    await get().load();
  },

  sync: async (options) => {
    const full = options?.full === true;
    const background = options?.background === true;
    if (activeRun(get())) {
      // 已有对账在跑：不并发（后端对账持有全局锁），合并成跑完后的一轮。
      const run: SyncRun = { full, background, phase: 'sync', done: 0, total: 0 };
      set({ pendingSync: mergeSyncRequest(get().pendingSync, run) });
      return;
    }
    await runSync({ full, background });
  },

  remove: async (id) => {
    try {
      await deleteDataSource(id);
      set({ items: get().items.filter((item) => item.id !== id), errorKey: null });
    } catch (err) {
      set({ errorKey: errorKeyOf(err, 'error.deleteFailed') });
    }
  },

  reset: () =>
    set({
      items: [],
      importing: null,
      syncing: false,
      syncingFull: false,
      backgroundSync: null,
      pendingSync: null,
      lastSync: null,
      importFailed: {},
      errorKey: null,
    }),
  };
});
