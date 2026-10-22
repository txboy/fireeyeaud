import { create } from 'zustand';
import type { ConfigScope, TemplateInfo, TemplateKind } from '@fireeyeaud/shared';
import {
  deleteTemplateApi,
  duplicateTemplateApi,
  listTemplates,
  patchTemplate,
  uploadTemplates,
} from '../lib/api';

interface TemplatesState {
  items: TemplateInfo[];
  loading: boolean;
  errorKey: string | null;
  load: () => Promise<void>;
  upload: (
    kind: TemplateKind,
    paths: string[],
    scope: ConfigScope,
    isDefault?: boolean,
  ) => Promise<void>;
  rename: (id: string, scope: ConfigScope, name: string) => Promise<void>;
  setDefault: (id: string, scope: ConfigScope) => Promise<void>;
  remove: (id: string, scope: ConfigScope) => Promise<void>;
  duplicate: (
    id: string,
    scope: ConfigScope,
    targetScope: ConfigScope,
  ) => Promise<void>;
  reset: () => void;
}

/** 模板中心：列表是全局 ∪ 项目（项目覆盖同 id），上传/改名/设默认后统一重载。 */
export const useTemplatesStore = create<TemplatesState>((set, get) => ({
  items: [],
  loading: false,
  errorKey: null,

  load: async () => {
    set({ loading: true, errorKey: null });
    try {
      const page = await listTemplates();
      set({ items: page.items, loading: false });
    } catch (err) {
      set({
        loading: false,
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal',
      });
    }
  },

  upload: async (kind, paths, scope, isDefault = false) => {
    try {
      await uploadTemplates(kind, paths, scope, isDefault);
      await get().load();
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
      throw err;
    }
  },

  rename: async (id, scope, name) => {
    await patchTemplate(id, scope, { name });
    await get().load();
  },

  setDefault: async (id, scope) => {
    await patchTemplate(id, scope, { isDefault: true });
    await get().load();
  },

  remove: async (id, scope) => {
    await deleteTemplateApi(id, scope);
    await get().load();
  },

  duplicate: async (id, scope, targetScope) => {
    await duplicateTemplateApi(id, scope, targetScope);
    await get().load();
  },

  reset: () => set({ items: [], loading: false, errorKey: null }),
}));