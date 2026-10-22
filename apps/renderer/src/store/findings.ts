import { create } from 'zustand';
import type { Finding } from '@fireeyeaud/shared';
import {
  createFindingApi,
  deleteFindingApi,
  listFindings,
  reviewFindingApi,
  type CreateFindingInput,
  type ReviewInput,
} from '../lib/api';

interface FindingsState {
  items: Finding[];
  loading: boolean;
  errorKey: string | null;
  /** 勾选用于生成取证单 / 报告（跨 tab 保留）。 */
  selectedIds: string[];
  load: (params?: { severity?: string; status?: string; limit?: number }) => Promise<void>;
  create: (input: CreateFindingInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  review: (id: string, body: ReviewInput) => Promise<void>;
  toggleSelected: (id: string) => void;
  clearSelected: () => void;
  reset: () => void;
}

function messageKey(err: unknown): string {
  return (err as { messageKey?: string }).messageKey ?? 'error.internal';
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
      set((state) => ({
        items: page.items,
        loading: false,
        // 已删除的疑点不能留在勾选里，否则生成时会带上看不见的条目
        selectedIds: state.selectedIds.filter((id) =>
          page.items.some((item) => item.id === id),
        ),
      }));
    } catch (err) {
      set({ loading: false, errorKey: messageKey(err) });
    }
  },

  create: async (input) => {
    await createFindingApi(input);
    await get().load();
  },

  remove: async (id) => {
    await deleteFindingApi(id);
    set((state) => ({ selectedIds: state.selectedIds.filter((item) => item !== id) }));
    await get().load();
  },

  review: async (id, body) => {
    await reviewFindingApi(id, body);
    await get().load();
  },

  toggleSelected: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((item) => item !== id)
        : [...state.selectedIds, id],
    })),

  clearSelected: () => set({ selectedIds: [] }),

  reset: () => set({ items: [], loading: false, errorKey: null, selectedIds: [] }),
}));