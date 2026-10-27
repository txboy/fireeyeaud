import { create } from 'zustand';
import type { ArtifactPreview, ReportManifest } from '@fireeyeaud/shared';
import {
  commitReport,
  deleteReport,
  listReports,
  previewReport,
  type GenerateReportInput,
} from '../lib/api';
import { errorKeyOf } from '../lib/errorKey';

interface ReportsState {
  items: ReportManifest[];
  loading: boolean;
  errorKey: string | null;
  load: () => Promise<void>;
  preview: (input: GenerateReportInput) => Promise<ArtifactPreview>;
  commit: (token: string, title?: string) => Promise<ReportManifest>;
  remove: (id: string) => Promise<void>;
  reset: () => void;
}

/** 项目报告列表：预览与保存分开，保存成功后才刷新列表。 */
export const useReportsStore = create<ReportsState>((set, get) => ({
  items: [],
  loading: false,
  errorKey: null,

  load: async () => {
    set({ loading: true, errorKey: null });
    try {
      const page = await listReports();
      set({ items: page.items, loading: false });
    } catch (err) {
      set({ loading: false, errorKey: errorKeyOf(err) });
    }
  },

  preview: (input) => previewReport(input),

  commit: async (token, title) => {
    const manifest = await commitReport(token, title);
    await get().load();
    return manifest;
  },

  remove: async (id) => {
    try {
      await deleteReport(id);
      await get().load();
    } catch (err) {
      set({ errorKey: errorKeyOf(err) });
      throw err;
    }
  },

  reset: () => set({ items: [], loading: false, errorKey: null }),
}));