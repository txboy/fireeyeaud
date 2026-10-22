import { create } from 'zustand';
import type { ReportDocument } from '@fireeyeaud/shared';
import { getReportDocument, setReportOutline } from '../lib/api';

interface ReportDocState {
  docs: Record<string, ReportDocument>;
  loading: Record<string, boolean>;
  errorKey: string | null;
  load: (reportId: string) => Promise<ReportDocument | null>;
  saveOutline: (reportId: string, approved: boolean) => Promise<void>;
  setDoc: (reportId: string, doc: ReportDocument) => void;
  reset: () => void;
}

function messageKey(err: unknown): string {
  return (err as { messageKey?: string }).messageKey ?? 'error.internal';
}

/** 报告工作台文档缓存：按报告 id 存 body / skeleton / manifest。 */
export const useReportDocStore = create<ReportDocState>((set, get) => ({
  docs: {},
  loading: {},
  errorKey: null,

  load: async (reportId) => {
    set((state) => ({
      loading: { ...state.loading, [reportId]: true },
      errorKey: null,
    }));
    try {
      const doc = await getReportDocument(reportId);
      set((state) => ({
        docs: { ...state.docs, [reportId]: doc },
        loading: { ...state.loading, [reportId]: false },
      }));
      return doc;
    } catch (err) {
      set((state) => ({
        loading: { ...state.loading, [reportId]: false },
        errorKey: messageKey(err),
      }));
      return null;
    }
  },

  saveOutline: async (reportId, approved) => {
    const doc = get().docs[reportId];
    const sections = (doc?.body.sections ?? []).map((section) => ({
      id: section.id,
      title: section.title,
      level: section.level,
      goal: section.goal,
    }));
    await setReportOutline(reportId, sections, approved);
    await get().load(reportId);
  },

  setDoc: (reportId, doc) =>
    set((state) => ({ docs: { ...state.docs, [reportId]: doc } })),

  reset: () => set({ docs: {}, loading: {}, errorKey: null }),
}));
