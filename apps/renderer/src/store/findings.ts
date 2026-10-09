import { create } from 'zustand';
import type { Finding } from '@fireeyeaud/shared';
import { listFindings, reviewFindingApi, type ReviewInput } from '../lib/api';

interface FindingsState {
  items: Finding[];
  loading: boolean;
  errorKey: string | null;
  load: (params?: { severity?: string; status?: string; limit?: number }) => Promise<void>;
  review: (id: string, body: ReviewInput) => Promise<void>;
  reset: () => void;
}

export const useFindingsStore = create<FindingsState>((set, get) => ({
  items: [],
  loading: false,
  errorKey: null,

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

  reset: () => set({ items: [], loading: false, errorKey: null }),
}));
