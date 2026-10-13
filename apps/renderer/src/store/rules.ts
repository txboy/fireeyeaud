import { create } from 'zustand';
import type { AuditRule } from '@fireeyeaud/shared';
import {
  createRule,
  deleteRuleApi,
  listRules,
  updateRuleApi,
  type RuleInput,
} from '../lib/api';

interface RulesState {
  items: AuditRule[];
  loading: boolean;
  errorKey: string | null;
  load: () => Promise<void>;
  add: (input: RuleInput) => Promise<boolean>;
  edit: (id: string, patch: RuleInput) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  reset: () => void;
}

export const useRulesStore = create<RulesState>((set, get) => ({
  items: [],
  loading: false,
  errorKey: null,

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
    set({ errorKey: null });
    try {
      await createRule(input);
      await get().load();
      return true;
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
      return false;
    }
  },

  edit: async (id, patch) => {
    set({ errorKey: null });
    try {
      await updateRuleApi(id, patch);
      await get().load();
      return true;
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
      return false;
    }
  },

  remove: async (id) => {
    await deleteRuleApi(id);
    await get().load();
  },

  reset: () => set({ items: [], loading: false, errorKey: null }),
}));
