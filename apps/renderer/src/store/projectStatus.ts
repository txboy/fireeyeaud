import { useDatasourcesStore } from './datasources';
import { useWorkspaceStore } from './workspace';
import type { SyncRun } from './datasources';

/** 项目数据准备的整体状态（供资源管理器提示栏 / 状态栏共用）。 */
export interface ProjectStatus {
  /** 正在后台准备数据：首次打开大项目时可能要几分钟。 */
  preparing: boolean;
  /** 当前阶段的文案 key（见 datasources store 的 progress）。 */
  phase: string;
  done: number;
  total: number;
  /** 后台准备结束后一次性结果（用于提示"已更新 N 张表"）。 */
  justFinished: { added: number; removed: number; updated: number } | null;
}

let finishedAt = 0;

/** 订阅项目数据准备状态的变化；返回取消订阅函数。 */
export function subscribeProjectStatus(listener: (status: ProjectStatus) => void): () => void {
  const snapshot = () => {
    const state = useDatasourcesStore.getState();
    const run: SyncRun | null = state.backgroundSync;
    const wsPath = useWorkspaceStore.getState().path;
    listener({
      preparing: Boolean(run && wsPath),
      phase: run?.phase ?? 'sync',
      done: run?.done ?? 0,
      total: run?.total ?? 0,
      justFinished:
        state.lastSync &&
        finishedAt > 0 &&
        Date.now() - finishedAt < 5000 &&
        !state.syncing &&
        !run
          ? state.lastSync
          : null,
    });
  };
  const unsubscribeData = useDatasourcesStore.subscribe(snapshot);
  const unsubscribeWs = useWorkspaceStore.subscribe(snapshot);
  return () => {
    unsubscribeData();
    unsubscribeWs();
  };
}

/** 记录一次后台准备刚结束（由 WorkspaceWatcher 调用），供状态栏短暂提示。 */
export function markPrepared(): void {
  finishedAt = Date.now();
}