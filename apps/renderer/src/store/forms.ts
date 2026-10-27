import { create } from 'zustand';
import type { EvidenceFormDocument, EvidenceFormManifest } from '@fireeyeaud/shared';
import {
  attachReceipt,
  clearReceipt,
  createFormDraft,
  deleteEvidenceForm,
  listEvidenceForms,
  type CreateFormDraftInput,
} from '../lib/api';
import { errorKeyOf } from '../lib/errorKey';

interface FormsState {
  items: EvidenceFormManifest[];
  loading: boolean;
  errorKey: string | null;
  load: () => Promise<void>;
  create: (input: CreateFormDraftInput) => Promise<EvidenceFormDocument>;
  remove: (id: string) => Promise<void>;
  attach: (id: string, path: string, note?: string) => Promise<void>;
  clear: (id: string) => Promise<void>;
  reset: () => void;
}

/** 取证单列表：新建即进入写作台（草稿），导出后才生成 document.docx。 */
export const useFormsStore = create<FormsState>((set, get) => ({
  items: [],
  loading: false,
  errorKey: null,

  load: async () => {
    set({ loading: true, errorKey: null });
    try {
      const page = await listEvidenceForms();
      set({ items: page.items, loading: false });
    } catch (err) {
      set({ loading: false, errorKey: errorKeyOf(err) });
    }
  },

  create: async (input) => {
    const doc = await createFormDraft(input);
    await get().load();
    return doc;
  },

  remove: async (id) => {
    try {
      await deleteEvidenceForm(id);
      await get().load();
    } catch (err) {
      set({ errorKey: errorKeyOf(err) });
      throw err;
    }
  },

  attach: async (id, path, note) => {
    await withError(set, async () => {
      await attachReceipt(id, path, note);
      await get().load();
    });
  },

  clear: async (id) => {
    await withError(set, async () => {
      await clearReceipt(id);
      await get().load();
    });
  },

  reset: () => set({ items: [], loading: false, errorKey: null }),
}));

/** 统一错误处理：记录可本地化的 messageKey 并向上抛，供弹窗提示。 */
async function withError(
  set: (partial: Partial<FormsState>) => void,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (err) {
    set({ errorKey: errorKeyOf(err) });
    throw err;
  }
}