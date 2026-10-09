import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { ActivityRail } from './components/ActivityRail';
import { SideBar } from './components/SideBar';
import { AgentColumn } from './components/AgentColumn';
import { ResultsColumn } from './components/ResultsColumn';
import { StatusBar } from './components/StatusBar';
import { useSidecarStore } from './store/sidecar';

export default function App() {
  const init = useSidecarStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app">
      <TitleBar />
      <div className="app__body">
        <ActivityRail />
        <SideBar />
        <AgentColumn />
        <ResultsColumn />
      </div>
      <StatusBar />
    </div>
  );
}
