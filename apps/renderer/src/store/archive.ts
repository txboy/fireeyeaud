import { create } from 'zustand';
import type {
  ArchiveConflictCheck,
  ArchiveHistoryItem,
  ArchiveStatus,
} from '@fireeyeaud/shared';
import {
  checkArchiveConflict,
  commitArchive,
  getArchiveChanges,
  getArchiveStatus,
  initArchive,
  listArchiveHistory,
  pushArchive,
  resolveArchiveConflict,
  setArchiveRemote,
} from '../lib/api';
import { errorKeyOf } from '../lib/errorKey';

interface ArchiveState {
  status: ArchiveStatus | null;
  history: ArchiveHistoryItem[];
  changes: Record<string, Array<{ path: string; status: string }>>;
  loading: boolean;
  errorKey: string | null;
  load: () => Promise<void>;
  init: () => Promise<void>;
  commit: (message?: string) => Promise<void>;
  push: (archiveId?: string) => Promise<{ ok: boolean; pushed?: string[]; skipped?: string[] }>;
  saveRemote: (input: {
    url: string;
    username: string;
    credRef: string | null;
    autoPush: boolean;
  }) => Promise<void>;
  loadChanges: (archiveId: string) => Promise<void>;
  check: () => Promise<ArchiveConflictCheck>;
  resolve: (input: Parameters<typeof resolveArchiveConflict>[0]) => Promise<void>;
  reset: () => void;
}

/** 归档视图状态：状态 + 历史；写操作成功后重新加载。 */
export const useArchiveStore = create<ArchiveState>((set, get) => ({
  status: null,
  history: [],
  changes: {},
  loading: false,
  errorKey: null,

  load: async () => {
    set({ loading: true, errorKey: null });
    try {
      const [status, history] = await Promise.all([
        getArchiveStatus(),
        listArchiveHistory(),
      ]);
      set({ status, history: history.items, loading: false });
    } catch (err) {
      set({ loading: false, errorKey: errorKeyOf(err) });
    }
  },

  init: async () => {
    try {
      await initArchive();
      await get().load();
    } catch (err) {
      set({ errorKey: errorKeyOf(err) });
      throw err;
    }
  },

  commit: async (message) => {
    try {
      await commitArchive(message);
      await get().load();
    } catch (err) {
      set({ errorKey: errorKeyOf(err) });
      throw err;
    }
  },

  push: async (archiveId) => {
    try {
      const result = await pushArchive(archiveId);
      await get().load();
      return result;
    } catch (err) {
      set({ errorKey: errorKeyOf(err) });
      throw err;
    }
  },

  saveRemote: async (input) => {
    try {
      await setArchiveRemote(input);
      await get().load();
    } catch (err) {
      set({ errorKey: errorKeyOf(err) });
      throw err;
    }
  },

  loadChanges: async (archiveId) => {
    const items = await getArchiveChanges(archiveId);
    set((state) => ({
      changes: { ...state.changes, [archiveId]: items.items },
    }));
  },

  check: () => checkArchiveConflict(),

  resolve: async (input) => {
    try {
      await resolveArchiveConflict(input);
      await get().load();
    } catch (err) {
      set({ errorKey: errorKeyOf(err) });
      throw err;
    }
  },

  reset: () => set({ status: null, history: [], changes: {}, errorKey: null }),
}));