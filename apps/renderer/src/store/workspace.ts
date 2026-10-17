import { create } from 'zustand';
import type { WorkspaceInfo } from '@fireeyeaud/shared';
import { ApiError, closeWorkspaceApi, openWorkspaceApi } from '../lib/api';
import { confirmStopAll } from '../lib/stop-guard';

/** 「最近打开的工作区」条目（仅客户端持久化，落 localStorage）。 */
export interface RecentWorkspace {
  path: string;
  name: string;
  lastOpenedAt: number;
  findings: number;
}

const RECENT_KEY = 'fireeyeaud.recentWorkspaces';
const RECENT_MAX = 8;

function loadRecent(): RecentWorkspace[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentWorkspace =>
        Boolean(item) && typeof (item as RecentWorkspace).path === 'string',
    );
  } catch {
    return [];
  }
}

function saveRecent(items: RecentWorkspace[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(items));
  } catch {
    /* 忽略写入失败（隐私模式等） */
  }
}

interface WorkspaceState {
  workspace: WorkspaceInfo | null;
  path: string | null;
  loading: boolean;
  error: ApiError | null;
  recent: RecentWorkspace[];
  /** 工作区外部文件变化的修订号：变化时自增，供文件树等刷新。 */
  fsRevision: number;
  bumpFsRevision: () => void;
  openFromDialog: () => Promise<void>;
  openPath: (path: string) => Promise<void>;
  removeRecent: (path: string) => void;
  close: () => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: null,
  path: null,
  loading: false,
  error: null,
  recent: loadRecent(),
  fsRevision: 0,

  bumpFsRevision: () => set((s) => ({ fsRevision: s.fsRevision + 1 })),

  openPath: async (path) => {
    // 切换工作区若有会话正在生成，先警告并中止。
    if (!(await confirmStopAll())) return;
    set({ loading: true, error: null });
    try {
      const workspace = await openWorkspaceApi(path);
      const entry: RecentWorkspace = {
        path,
        name: workspace.name,
        lastOpenedAt: Date.now(),
        findings: workspace.counters?.finding ?? 0,
      };
      const recent = [entry, ...get().recent.filter((r) => r.path !== path)].slice(
        0,
        RECENT_MAX,
      );
      saveRecent(recent);
      set({ workspace, path, loading: false, recent });
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

  removeRecent: (path) => {
    const recent = get().recent.filter((r) => r.path !== path);
    saveRecent(recent);
    set({ recent });
  },

  close: async () => {
    if (!(await confirmStopAll())) return;
    try {
      await closeWorkspaceApi();
    } catch {
      /* 关闭失败也清空本地状态 */
    }
    set({ workspace: null, path: null, error: null });
  },
}));
