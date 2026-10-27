import { create } from 'zustand';
import type { ConfigScope, TemplateInfo, TemplateKind } from '@fireeyeaud/shared';
import {
  deleteTemplateApi,
  duplicateTemplateApi,
  listTemplates,
  patchTemplate,
  uploadTemplates,
} from '../lib/api';
import { errorKeyOf } from '../lib/errorKey';

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
    name?: string,
  ) => Promise<void>;
  /** 改名 / 设默认 / 搬家（scope 为目标作用域）。 */
  edit: (
    id: string,
    scope: ConfigScope,
    patch: { name?: string; isDefault?: boolean; scope?: ConfigScope },
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
        errorKey: errorKeyOf(err),
      });
    }
  },

  upload: async (kind, paths, scope, isDefault = false, name) => {
    await withError(set, async () => {
      await uploadTemplates(kind, paths, scope, isDefault, name);
      await get().load();
    });
  },

  edit: async (id, scope, patch) => {
    await withError(set, async () => {
      await patchTemplate(id, scope, patch);
      await get().load();
    });
  },

  rename: async (id, scope, name) => {
    await get().edit(id, scope, { name });
  },

  setDefault: async (id, scope) => {
    await get().edit(id, scope, { isDefault: true });
  },

  remove: async (id, scope) => {
    await withError(set, async () => {
      await deleteTemplateApi(id, scope);
      await get().load();
    });
  },

  duplicate: async (id, scope, targetScope) => {
    await withError(set, async () => {
      await duplicateTemplateApi(id, scope, targetScope);
      await get().load();
    });
  },

  reset: () => set({ items: [], loading: false, errorKey: null }),
}));

/**
 * 统一错误处理：记录可本地化的 messageKey 并向上抛，让调用方能保持弹窗打开。
 * 没有它，改名/设默认/删除失败会变成未处理的 Promise rejection，界面上毫无反馈。
 */
async function withError(
  set: (partial: Partial<TemplatesState>) => void,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (err) {
    set({ errorKey: errorKeyOf(err) });
    throw err;
  }
}