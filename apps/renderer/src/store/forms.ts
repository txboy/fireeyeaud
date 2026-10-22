import { create } from 'zustand';
import type { ArtifactPreview, EvidenceFormManifest } from '@fireeyeaud/shared';
import {
  attachReceipt,
  clearReceipt,
  commitEvidenceForm,
  deleteEvidenceForm,
  listEvidenceForms,
  previewEvidenceForm,
  type GenerateFormInput,
} from '../lib/api';

interface FormsState {
  items: EvidenceFormManifest[];
  loading: boolean;
  errorKey: string | null;
  load: () => Promise<void>;
  preview: (input: GenerateFormInput) => Promise<ArtifactPreview>;
  commit: (token: string, title?: string) => Promise<EvidenceFormManifest>;
  remove: (id: string) => Promise<void>;
  attach: (id: string, path: string) => Promise<void>;
  clear: (id: string) => Promise<void>;
  reset: () => void;
}

function messageKey(err: unknown): string {
  return (err as { messageKey?: string }).messageKey ?? 'error.internal';
}

/** 取证单列表：预览与保存分开，保存成功后才刷新列表。 */
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
      set({ loading: false, errorKey: messageKey(err) });
    }
  },

  preview: async (input) => {
    const preview = await previewEvidenceForm(input);
    return preview;
  },

  commit: async (token, title) => {
    const manifest = await commitEvidenceForm(token, title);
    await get().load();
    return manifest;
  },

  remove: async (id) => {
    try {
      await deleteEvidenceForm(id);
      await get().load();
    } catch (err) {
      set({ errorKey: messageKey(err) });
      throw err;
    }
  },

  attach: async (id, path) => {
    await attachReceipt(id, path);
    await get().load();
  },

  clear: async (id) => {
    await clearReceipt(id);
    await get().load();
  },

  reset: () => set({ items: [], loading: false, errorKey: null }),
}));