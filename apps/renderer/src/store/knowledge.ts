import { create } from 'zustand';
import type { KbEnabledEntry, KbKnowledge, KbProvider } from '@fireeyeaud/shared';
import {
  createKbProvider,
  deleteKbProvider,
  listKbEnabled,
  listKbKnowledge,
  listKbProviders,
  setKbEnabled,
  testKbProvider,
  updateKbProvider,
  type KbProviderInput,
} from '../lib/api';

interface KnowledgeState {
  items: KbProvider[];
  loading: boolean;
  errorKey: string | null;
  knowledgeByProvider: Record<string, KbKnowledge[]>;
  enabled: KbEnabledEntry[];
  load: () => Promise<void>;
  create: (input: KbProviderInput) => Promise<boolean>;
  update: (
    id: string,
    scope: KbProvider['scope'],
    patch: Partial<KbProviderInput>,
  ) => Promise<void>;
  remove: (id: string, scope: KbProvider['scope']) => Promise<void>;
  test: (id: string, scope: KbProvider['scope']) => Promise<boolean>;
  loadKnowledge: (id: string, scope: KbProvider['scope']) => Promise<void>;
  setEnabled: (scope: KbProvider['scope'], items: KbEnabledEntry[]) => Promise<void>;
  reset: () => void;
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  items: [],
  loading: false,
  errorKey: null,
  knowledgeByProvider: {},
  enabled: [],

  load: async () => {
    set({ loading: true, errorKey: null });
    try {
      const page = await listKbProviders();
      const enabled = (await listKbEnabled()).items;
      set({ items: page.items, enabled, loading: false });
    } catch (err) {
      set({
        loading: false,
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal',
      });
    }
  },

  create: async (input) => {
    set({ errorKey: null });
    try {
      await createKbProvider(input);
      await get().load();
      return true;
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
      return false;
    }
  },

  update: async (id, scope, patch) => {
    await updateKbProvider(id, scope, patch);
    await get().load();
  },

  remove: async (id, scope) => {
    await deleteKbProvider(id, scope);
    await get().load();
  },

  test: async (id, scope) => {
    set({ errorKey: null });
    try {
      const res = await testKbProvider(id, scope);
      return res.ok;
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
      return false;
    }
  },

  loadKnowledge: async (id, scope) => {
    set({ errorKey: null });
    try {
      const res = await listKbKnowledge(id, scope);
      set((s) => ({
        knowledgeByProvider: { ...s.knowledgeByProvider, [id]: res.items },
      }));
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
    }
  },

  setEnabled: async (scope, items) => {
    const res = await setKbEnabled(scope, items);
    const enabled = (await listKbEnabled()).items;
    set({ enabled: res.items ?? enabled });
  },

  reset: () =>
    set({
      items: [],
      loading: false,
      errorKey: null,
      knowledgeByProvider: {},
      enabled: [],
    }),
}));
