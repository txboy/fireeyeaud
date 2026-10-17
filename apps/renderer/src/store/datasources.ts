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
  lastSync: { added: number; removed: number; updated: number } | null;
  errorKey: string | null;
  load: () => Promise<void>;
  importPath: (path: string) => Promise<void>;
  sync: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  reset: () => void;
}

export const useDatasourcesStore = create<DatasourcesState>((set, get) => ({
  items: [],
  importing: null,
  syncing: false,
  lastSync: null,
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
            set({ errorKey: String(data.messageKey ?? 'error.importParse') });
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

  sync: async () => {
    if (get().syncing) return;
    set({ syncing: true, errorKey: null });
    try {
      const result = await syncDatasources({
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
      });
      await get().load();
    } catch (err) {
      set({
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal',
      });
    }
    set({ syncing: false });
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
      lastSync: null,
      errorKey: null,
    }),
}));
