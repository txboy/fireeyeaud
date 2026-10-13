import { create } from 'zustand';
import type { ModelProfile } from '@fireeyeaud/shared';
import {
  createModel,
  deleteModelApi,
  listModels,
  testModel,
  testModelParams,
  updateModel,
  type ModelInput,
} from '../lib/api';

interface ModelsState {
  items: ModelProfile[];
  loading: boolean;
  errorKey: string | null;
  load: () => Promise<void>;
  add: (input: ModelInput) => Promise<void>;
  edit: (id: string, scope: ModelProfile['scope'], patch: Partial<ModelInput>) => Promise<void>;
  remove: (id: string, scope: ModelProfile['scope']) => Promise<void>;
  test: (id: string, scope: ModelProfile['scope']) => Promise<boolean>;
  testParams: (input: { baseUrl?: string; model?: string }) => Promise<boolean>;
  reset: () => void;
}

export const useModelsStore = create<ModelsState>((set, get) => ({
  items: [],
  loading: false,
  errorKey: null,

  load: async () => {
    set({ loading: true, errorKey: null });
    try {
      const page = await listModels();
      set({ items: page.items, loading: false });
    } catch (err) {
      set({
        loading: false,
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal',
      });
    }
  },

  add: async (input) => {
    await createModel(input);
    await get().load();
  },

  edit: async (id, scope, patch) => {
    await updateModel(id, scope, patch);
    await get().load();
  },

  remove: async (id, scope) => {
    await deleteModelApi(id, scope);
    await get().load();
  },

  test: async (id, scope) => {
    const res = await testModel(id, scope);
    return res.ok;
  },

  testParams: async (input) => {
    const res = await testModelParams(input);
    return res.ok;
  },

  reset: () => set({ items: [], loading: false, errorKey: null }),
}));
