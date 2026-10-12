import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { ActivityRail } from './components/ActivityRail';
import { SideBar } from './components/SideBar';
import { RightArea } from './components/RightArea';
import { StatusBar } from './components/StatusBar';
import { Welcome } from './components/Welcome';
import { ConfirmDialog } from './components/ConfirmDialog';
import { useSidecarStore } from './store/sidecar';
import { useWorkspaceStore } from './store/workspace';

export default function App() {
  const init = useSidecarStore((s) => s.init);
  const workspace = useWorkspaceStore((s) => s.workspace);

  useEffect(() => {
    void init();
  }, [init]);

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
    </div>
  );
}
