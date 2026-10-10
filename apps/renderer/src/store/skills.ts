import { create } from 'zustand';
import type { ConfigScope, Skill } from '@fireeyeaud/shared';
import {
  createSkill,
  deleteSkill,
  listSkills,
  updateSkill,
  type SkillInput,
} from '../lib/api';

interface SkillsState {
  items: Skill[];
  loading: boolean;
  errorKey: string | null;
  load: () => Promise<void>;
  create: (input: SkillInput) => Promise<boolean>;
  toggle: (id: string, scope: ConfigScope, enabled: boolean) => Promise<void>;
  remove: (id: string, scope: ConfigScope) => Promise<void>;
  reset: () => void;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  items: [],
  loading: false,
  errorKey: null,

  load: async () => {
    set({ loading: true, errorKey: null });
    try {
      const page = await listSkills();
      set({ items: page.items, loading: false });
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
      await createSkill(input);
      await get().load();
      return true;
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
      return false;
    }
  },

  toggle: async (id, scope, enabled) => {
    await updateSkill(id, scope, { enabled });
    await get().load();
  },

  remove: async (id, scope) => {
    await deleteSkill(id, scope);
    await get().load();
  },

  reset: () => set({ items: [], loading: false, errorKey: null }),
}));
