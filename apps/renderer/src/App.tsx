import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { ActivityRail } from './components/ActivityRail';
import { SideBar } from './components/SideBar';
import { RightArea } from './components/RightArea';
import { StatusBar } from './components/StatusBar';
import { Welcome } from './components/Welcome';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PromptDialog } from './components/PromptDialog';
import { AttachDbDialog } from './components/AttachDbDialog';
import { WorkspaceWatcher } from './components/WorkspaceWatcher';
import { useSidecarStore } from './store/sidecar';
import { useWorkspaceStore } from './store/workspace';
import { useUiStore } from './store/ui';
import { useChatStore } from './store/chat';

export default function App() {
  const init = useSidecarStore((s) => s.init);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const resetRightTabs = useUiStore((s) => s.resetRightTabs);
  const openSession = useUiStore((s) => s.openSession);
  const clearAllChats = useChatStore((s) => s.clearAllChats);
  const loadSessions = useChatStore((s) => s.loadSessions);

  useEffect(() => {
    void init();
  }, [init]);

  // 工作区生命周期：仅在真正打开/切换工作区时清空右侧并自动打开最近一条会话。
  // 放在 App（工作区存续期间始终挂载），使右侧区域独立于左侧面板的挂载/切换视图。
  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    void (async () => {
      resetRightTabs();
      clearAllChats();
      await loadSessions();
      if (cancelled) return;
      const list = useChatStore.getState().sessions;
      const last = list[list.length - 1];
      if (last) await openSession(last.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace, resetRightTabs, clearAllChats, loadSessions, openSession]);

  return (
    <div className="app">
      <TitleBar />
      {workspace ? (
        <>
          <div className="app__body">
            <ActivityRail />
            <SideBar />
            <RightArea />
          </div>
          <StatusBar />
        </>
      ) : (
        <Welcome />
      )}
      <ConfirmDialog />
      <PromptDialog />
      <AttachDbDialog />
      <WorkspaceWatcher />
    </div>
  );
}
