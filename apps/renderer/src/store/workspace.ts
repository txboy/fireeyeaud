import { create } from 'zustand';
import type { WorkspaceInfo } from '@fireeyeaud/shared';
import { ApiError, closeWorkspaceApi, openWorkspaceApi } from '../lib/api';

interface WorkspaceState {
  workspace: WorkspaceInfo | null;
  path: string | null;
  loading: boolean;
  error: ApiError | null;
  openFromDialog: () => Promise<void>;
  openPath: (path: string) => Promise<void>;
  close: () => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: null,
  path: null,
  loading: false,
  error: null,

  openPath: async (path) => {
    set({ loading: true, error: null });
    try {
      const workspace = await openWorkspaceApi(path);
      set({ workspace, path, loading: false });
    } catch (err) {
      set({ loading: false, error: err as ApiError });
    }
  },

  openFromDialog: async () => {
    const api = window.fireeyeaud;
    if (!api) return;
    const path = await api.openFolder();
    if (!path) return;
    await get().openPath(path);
  },

  close: async () => {
    try {
      await closeWorkspaceApi();
    } catch {
      /* 关闭失败也清空本地状态 */
    }
    set({ workspace: null, path: null, error: null });
  },
}));
