import { create } from 'zustand';
import type { WorkspaceInfo } from '@fireeyeaud/shared';
import { ApiError, closeWorkspaceApi, openWorkspaceApi } from '../lib/api';
import { isTransientOpenError, retryDelayMs } from '../lib/openRetry';
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
/** 后端未就绪时自动重试的总时长（冷启动时机器很慢，给足 2 分钟）。 */
const OPEN_RETRY_TOTAL_MS = 120_000;

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
  /** 最近一次失败的本地化文案 key（`error.xxx`），供欢迎页展示。 */
  errorKey: string | null;
  recent: RecentWorkspace[];
  /** 工作区外部文件变化的修订号：变化时自增，供文件树等刷新。 */
  fsRevision: number;
  bumpFsRevision: () => void;
  openFromDialog: () => Promise<void>;
  openPath: (path: string) => Promise<void>;
  removeRecent: (path: string) => void;
  close: () => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /** 正在打开的路径：防重复点击，也让"打开途中又点别的项目"能取消前一次。 */
  let openingPath: string | null = null;

  /**
   * 打开工作区：后端还没起来（冷启动时常见）就自动重试，最多等约 2 分钟。
   * 用户点一次即可，后端一就绪就自动进入项目，不再弹「发生内部错误」。
   */
  const openWorkspaceWithRetry = async (path: string): Promise<WorkspaceInfo> => {
    const deadline = Date.now() + OPEN_RETRY_TOTAL_MS;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await openWorkspaceApi(path);
      } catch (err) {
        if (
          !isTransientOpenError(err) ||
          openingPath !== path ||
          Date.now() >= deadline
        ) {
          throw err;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelayMs(attempt)),
        );
        if (openingPath !== path) throw err;
      }
    }
  };

  return {
  workspace: null,
  path: null,
  loading: false,
  error: null,
  errorKey: null,
  recent: loadRecent(),
  fsRevision: 0,

  bumpFsRevision: () => set((s) => ({ fsRevision: s.fsRevision + 1 })),

  openPath: async (path) => {
    // 切换工作区若有会话正在生成，先警告并中止。
    if (!(await confirmStopAll())) return;
    // 同一路径正在打开：重复点击不再叠加一轮重试。
    if (get().loading && openingPath === path) return;
    openingPath = path;
    set({ loading: true, error: null, errorKey: null });
    try {
      const workspace = await openWorkspaceWithRetry(path);
      if (openingPath !== path) return; // 打开期间用户又点了别的项目
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
      if (openingPath !== path) return;
      set({
        loading: false,
        error: err as ApiError,
        errorKey:
          (err as { messageKey?: string }).messageKey ?? 'error.internal',
      });
    } finally {
      if (openingPath === path) openingPath = null;
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
    set({ workspace: null, path: null, error: null, errorKey: null });
  },
  };
});
