import { useEffect } from 'react';
import { useDatasourcesStore } from '../store/datasources';
import { useWorkspaceStore } from '../store/workspace';

/**
 * 工作区文件变化监听：
 * - 打开工作区时启动主进程递归监听；外部增删改文件后（去抖）自动触发数据源对账并刷新文件树。
 * - 打开工作区的瞬间先对账一次，覆盖"软件关闭期间"发生的文件变化。
 */
export function WorkspaceWatcher() {
  const path = useWorkspaceStore((s) => s.path);
  const bumpFsRevision = useWorkspaceStore((s) => s.bumpFsRevision);

  // 打开工作区：对账一次（覆盖关闭期间的变化）+ 启动监听。
  useEffect(() => {
    const api = window.fireeyeaud;
    if (!api || !path) return;
    // 启动/打开工作区：忽略指纹缓存，全量重新导入数据表。
    void useDatasourcesStore.getState().sync({ full: true });
    void api.watchWorkspace(path);
    return () => {
      void api.unwatchWorkspace();
    };
  }, [path]);

  // 外部文件变化 → 对账 + 刷新文件树。
  useEffect(() => {
    const api = window.fireeyeaud;
    if (!api?.onWorkspaceFsChanged) return;
    return api.onWorkspaceFsChanged(() => {
      void useDatasourcesStore.getState().sync();
      bumpFsRevision();
    });
  }, [bumpFsRevision]);

  return null;
}
