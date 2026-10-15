import { create } from 'zustand';
import type {
  KbEnabledEntry,
  KbKnowledge,
  KbProvider,
  KbQueryResult,
} from '@fireeyeaud/shared';
import {
  createKbProvider,
  deleteKbProvider,
  listKbEnabled,
  listKbKnowledge,
  listKbProviders,
  queryKbProvider,
  setKbEnabled,
  testKbParams,
  testKbProvider,
  updateKbProvider,
  type KbProviderInput,
  type KbQueryInput,
  type KbTestInput,
} from '../lib/api';

interface KnowledgeState {
  items: KbProvider[];
  loading: boolean;
  errorKey: string | null;
  /** 检索测试失败时的后端原始原因（用于诊断，非 i18n 键）。 */
  queryError: string | null;
  knowledgeByProvider: Record<string, KbKnowledge[]>;
  enabled: KbEnabledEntry[];
  load: () => Promise<void>;
  create: (input: KbProviderInput) => Promise<boolean>;
  edit: (
    id: string,
    scope: KbProvider['scope'],
    patch: Partial<KbProviderInput>,
  ) => Promise<boolean>;
  remove: (id: string, scope: KbProvider['scope']) => Promise<void>;
  test: (
    id: string,
    scope: KbProvider['scope'],
  ) => Promise<{ ok: boolean; knowledgeCount: number }>;
  testParams: (input: KbTestInput) => Promise<boolean>;
  query: (id: string, input: KbQueryInput) => Promise<KbQueryResult | null>;
  loadKnowledge: (id: string, scope: KbProvider['scope']) => Promise<void>;
  setEnabled: (scope: KbProvider['scope'], items: KbEnabledEntry[]) => Promise<void>;
  reset: () => void;
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  items: [],
  loading: false,
  errorKey: null,
  queryError: null,
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

  edit: async (id, scope, patch) => {
    set({ errorKey: null });
    try {
      await updateKbProvider(id, scope, patch);
      await get().load();
      return true;
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
      return false;
    }
  },

  remove: async (id, scope) => {
    await deleteKbProvider(id, scope);
    await get().load();
  },

  test: async (id, scope) => {
    set({ errorKey: null });
    try {
      const res = await testKbProvider(id, scope);
      return { ok: res.ok, knowledgeCount: res.knowledgeCount ?? 0 };
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
      return { ok: false, knowledgeCount: 0 };
    }
  },

  testParams: async (input) => {
    set({ errorKey: null });
    try {
      const res = await testKbParams(input);
      return res.ok;
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
      return false;
    }
  },

  query: async (id, input) => {
    set({ errorKey: null, queryError: null });
    try {
      return await queryKbProvider(id, input);
    } catch (err) {
      const e = err as { messageKey?: string; params?: { reason?: string } };
      set({
        errorKey: e.messageKey ?? 'error.internal',
        queryError: e.params?.reason ?? null,
      });
      return null;
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
      queryError: null,
      knowledgeByProvider: {},
      enabled: [],
    }),
}));
