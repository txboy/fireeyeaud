import { create } from 'zustand';
import type { AuditRule } from '@fireeyeaud/shared';
import {
  createRule,
  deleteRuleApi,
  listRules,
  updateRuleApi,
  type RuleInput,
} from '../lib/api';
import { errorKeyOf } from '../lib/errorKey';

interface RulesState {
  items: AuditRule[];
  loading: boolean;
  errorKey: string | null;
  load: () => Promise<void>;
  add: (input: RuleInput) => Promise<boolean>;
  edit: (id: string, scope: AuditRule['scope'], patch: RuleInput) => Promise<boolean>;
  remove: (id: string, scope: AuditRule['scope']) => Promise<void>;
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
        errorKey: errorKeyOf(err),
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
      set({ errorKey: errorKeyOf(err) });
      return false;
    }
  },

  edit: async (id, scope, patch) => {
    set({ errorKey: null });
    try {
      await updateRuleApi(id, scope, patch);
      await get().load();
      return true;
    } catch (err) {
      set({ errorKey: errorKeyOf(err) });
      return false;
    }
  },

  remove: async (id, scope) => {
    await deleteRuleApi(id, scope);
    await get().load();
  },

  reset: () => set({ items: [], loading: false, errorKey: null }),
}));
