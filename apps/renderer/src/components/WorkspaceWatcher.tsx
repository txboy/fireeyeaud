import { useEffect } from 'react';
import { useDatasourcesStore } from '../store/datasources';
import { useWorkspaceStore } from '../store/workspace';
import { markPrepared } from '../store/projectStatus';

/**
 * 工作区文件变化监听：
 * - 打开工作区时启动主进程递归监听；外部增删改文件后（去抖）自动触发数据源对账并刷新文件树。
 * - 打开工作区的瞬间先对账一次，覆盖"软件关闭期间"发生的文件变化。
 *
 * 对账一律走**后台**：界面不等它，资源管理器/状态栏会提示"正在准备项目数据"。
 */
export function WorkspaceWatcher() {
  const path = useWorkspaceStore((s) => s.path);
  const bumpFsRevision = useWorkspaceStore((s) => s.bumpFsRevision);

  // 打开工作区：后台对账一次 + 启动监听。
  // 用增量而不是 full：指纹已改存源文件 mtime，没变的文件不会再读盘重导；
  // 表丢失/需要重导时由资源管理器的「重新导入」手动触发 full。
  useEffect(() => {
    const api = window.fireeyeaud;
    if (!api || !path) return;
    void useDatasourcesStore
      .getState()
      .sync({ background: true })
      .then(() => markPrepared());
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
      void useDatasourcesStore.getState().sync({ background: true });
      bumpFsRevision();
    });
  }, [bumpFsRevision]);

  return null;
}