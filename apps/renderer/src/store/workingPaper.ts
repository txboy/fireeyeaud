import { create } from 'zustand';
import type { WorkingPaperFormat, WorkingPaperManifest } from '@fireeyeaud/shared';
import { exportWorkingPaper, listWorkingPapers } from '../lib/api';

interface WorkingPaperState {
  items: WorkingPaperManifest[];
  loading: boolean;
  busy: boolean;
  errorKey: string | null;
  load: () => Promise<void>;
  generate: (format: WorkingPaperFormat, findingIds?: string[]) => Promise<boolean>;
}

export const useWorkingPaperStore = create<WorkingPaperState>((set, get) => ({
  items: [],
  loading: false,
  busy: false,
  errorKey: null,
  load: async () => {
    set({ loading: true, errorKey: null });
    try {
      const { items } = await listWorkingPapers();
      set({ items, loading: false });
    } catch (err) {
      set({
        loading: false,
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal',
      });
    }
  },
  generate: async (format, findingIds) => {
    set({ busy: true, errorKey: null });
    try {
      await exportWorkingPaper({ format, findingIds });
      set({ busy: false });
      await get().load();
      return true;
    } catch (err) {
      set({
        busy: false,
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal',
      });
      return false;
    }
  },
}));
