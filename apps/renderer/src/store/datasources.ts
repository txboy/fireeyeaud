import { create } from 'zustand';
import type { DataSourceInfo, SseEvent } from '@fireeyeaud/shared';
import {
  deleteDataSource,
  importDataSource,
  listDatasources,
  syncDatasources,
} from '../lib/api';

export interface ImportState {
  path: string;
  phase: string;
  done: number;
  total: number;
}

interface DatasourcesState {
  items: DataSourceInfo[];
  importing: ImportState | null;
  syncing: boolean;
  /** 当前同步是否为忽略指纹缓存的全量重导。 */
  syncingFull: boolean;
  lastSync: { added: number; removed: number; updated: number } | null;
  /** 导入失败的文件：路径 → 错误码（用于文件树上的失败标识）。 */
  importFailed: Record<string, string>;
  errorKey: string | null;
  load: () => Promise<void>;
  importPath: (path: string) => Promise<void>;
  sync: (options?: { full?: boolean }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reset: () => void;
}

export const useDatasourcesStore = create<DatasourcesState>((set, get) => ({
  items: [],
  importing: null,
  syncing: false,
  syncingFull: false,
  lastSync: null,
  importFailed: {},
  errorKey: null,

  load: async () => {
    try {
      const page = await listDatasources();
      set({ items: page.items, errorKey: null });
    } catch (err) {
      set({
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal',
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
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal',
      });
    }
    set({ importing: null });
    await get().load();
  },

  sync: async (options) => {
    if (get().syncing) return;
    const full = options?.full === true;
    set({ syncing: true, syncingFull: full, errorKey: null });
    try {
      const result = await syncDatasources({
        full,
        onEvent: (event: SseEvent) => {
          if (event.type === 'error') {
            const data = (event.data ?? {}) as Record<string, unknown>;
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
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal',
      });
    }
    set({ syncing: false, syncingFull: false });
  },

  remove: async (id) => {
    try {
      await deleteDataSource(id);
      set({ items: get().items.filter((item) => item.id !== id), errorKey: null });
    } catch (err) {
      set({
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.deleteFailed',
      });
    }
  },

  reset: () =>
    set({
      items: [],
      importing: null,
      syncing: false,
      syncingFull: false,
      lastSync: null,
      importFailed: {},
      errorKey: null,
    }),
}));
