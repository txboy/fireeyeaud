import { create } from 'zustand';
import type { EvidenceFormDocument, ReportDocument } from '@fireeyeaud/shared';
// 用相对导入 + `.ts` 后缀：本模块被 node 单测直接加载（不经 Vite），
// 无扩展名的相对导入在原生 ESM 下解析不到 errorKey.ts。
import { errorKeyOf } from '../lib/errorKey.ts';

export type WorkspaceDocument = ReportDocument | EvidenceFormDocument;

/** 写作台对后端的接口；由调用方注入，便于单测隔离。 */
export interface WorkspaceApi {
  get: (id: string) => Promise<WorkspaceDocument>;
  setOutline: (
    id: string,
    sections: Array<{ id: string; title: string; level: number; goal: string }>,
    approved: boolean,
  ) => Promise<unknown>;
}

export interface DocState {
  docs: Record<string, WorkspaceDocument>;
  loading: Record<string, boolean>;
  errorKey: string | null;
  load: (id: string) => Promise<WorkspaceDocument | null>;
  saveOutline: (id: string, approved: boolean) => Promise<void>;
  setDoc: (id: string, doc: WorkspaceDocument) => void;
  reset: () => void;
}

/** 写作台文档缓存：按 id 存 body / skeleton / manifest；报告与取证单共用同一实现。 */
export function createWorkspaceStore(api: WorkspaceApi) {
  return create<DocState>((set, get) => ({
    docs: {},
    loading: {},
    errorKey: null,

    load: async (id) => {
      set((state) => ({
        loading: { ...state.loading, [id]: true },
        errorKey: null,
      }));
      try {
        const doc = await api.get(id);
        set((state) => ({
          docs: { ...state.docs, [id]: doc },
          loading: { ...state.loading, [id]: false },
        }));
        return doc;
      } catch (err) {
        set((state) => ({
          loading: { ...state.loading, [id]: false },
          errorKey: errorKeyOf(err),
        }));
        return null;
      }
    },

    saveOutline: async (id, approved) => {
      const doc = get().docs[id];
      const sections = (doc?.body.sections ?? []).map((section) => ({
        id: section.id,
        title: section.title,
        level: section.level,
        goal: section.goal,
      }));
      await api.setOutline(id, sections, approved);
      await get().load(id);
    },

    setDoc: (id, doc) =>
      set((state) => ({ docs: { ...state.docs, [id]: doc } })),

    reset: () => set({ docs: {}, loading: {}, errorKey: null }),
  }));
}