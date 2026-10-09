import { create } from 'zustand';
import type { AuditRule } from '@fireeyeaud/shared';
import {
  createRule,
  deleteRuleApi,
  listRules,
  runAllRulesApi,
  runRuleApi,
  updateRuleApi,
  type RuleInput,
} from '../lib/api';

interface RulesState {
  items: AuditRule[];
  loading: boolean;
  errorKey: string | null;
  previewById: Record<string, Record<string, unknown>>;
  load: () => Promise<void>;
  add: (input: RuleInput) => Promise<void>;
  edit: (id: string, patch: RuleInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  preview: (id: string) => Promise<void>;
  runAll: () => Promise<number>;
  reset: () => void;
}

export const useRulesStore = create<RulesState>((set, get) => ({
  items: [],
  loading: false,
  errorKey: null,
  previewById: {},

  load: async () => {
    set({ loading: true, errorKey: null });
    try {
      const page = await listRules();
      set({ items: page.items, loading: false });
    } catch (err) {
      set({
        loading: false,
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal',
      });
    }
  },

  add: async (input) => {
    await createRule(input);
    await get().load();
  },

  edit: async (id, patch) => {
    await updateRuleApi(id, patch);
    await get().load();
  },

  remove: async (id) => {
    await deleteRuleApi(id);
    await get().load();
  },

  preview: async (id) => {
    try {
      const result = await runRuleApi(id);
      set((s) => ({ previewById: { ...s.previewById, [id]: result } }));
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
    }
  },

  runAll: async () => {
    const result = await runAllRulesApi();
    return result.count;
  },

  reset: () => set({ items: [], loading: false, errorKey: null, previewById: {} }),
}));
