import { create } from 'zustand';
import type { Finding } from '@fireeyeaud/shared';
import { listFindings, reviewFindingApi, type ReviewInput } from '../lib/api';

interface FindingsState {
  items: Finding[];
  loading: boolean;
  errorKey: string | null;
  /** 勾选用于生成取证单 / 报告的疑点（跨 tab 保留）。 */
  selectedIds: string[];
  load: (params?: { severity?: string; status?: string; limit?: number }) => Promise<void>;
  review: (id: string, body: ReviewInput) => Promise<void>;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  reset: () => void;
}

export const useFindingsStore = create<FindingsState>((set, get) => ({
  items: [],
  loading: false,
  errorKey: null,
  selectedIds: [],

  load: async (params) => {
    set({ loading: true, errorKey: null });
    try {
      const page = await listFindings(params);
      set({ items: page.items, loading: false });
    } catch (err) {
      set({
        loading: false,
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal',
      });
    }
  },

  review: async (id, body) => {
    await reviewFindingApi(id, body);
    await get().load();
  },

  toggleSelect: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((item) => item !== id)
        : [...state.selectedIds, id],
    })),

  clearSelection: () => set({ selectedIds: [] }),

  reset: () => set({ items: [], loading: false, errorKey: null, selectedIds: [] }),
}));