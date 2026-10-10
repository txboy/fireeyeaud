import { useTranslation } from 'react-i18next';
import type { ActivityView } from '@fireeyeaud/shared';
import { useUiStore } from '../store/ui';
import { ExplorerPanel } from './panels/ExplorerPanel';
import { SearchPanel } from './panels/SearchPanel';
import { DatabasePanel } from './panels/DatabasePanel';
import { KnowledgePanel } from './panels/KnowledgePanel';
import { ModelsPanel } from './panels/ModelsPanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { PlaceholderPanel } from './panels/PlaceholderPanel';

interface HeadMeta {
  titleNs: string;
  titleKey: string;
  subNs?: string;
  subKey?: string;
}

const HEAD: Record<ActivityView, HeadMeta> = {
  explorer: { titleNs: 'explorer', titleKey: 'title' },
  search: { titleNs: 'search', titleKey: 'title' },
  database: { titleNs: 'database', titleKey: 'title', subNs: 'database', subKey: 'subtitle' },
  knowledge: { titleNs: 'knowledge', titleKey: 'title', subNs: 'knowledge', subKey: 'subtitle' },
  mcp: { titleNs: 'mcp', titleKey: 'title', subNs: 'mcp', subKey: 'subtitle' },
  skills: { titleNs: 'skills', titleKey: 'title', subNs: 'skills', subKey: 'subtitle' },
  models: { titleNs: 'models', titleKey: 'title', subNs: 'models', subKey: 'subtitle' },
  settings: { titleNs: 'settings', titleKey: 'title', subNs: 'settings', subKey: 'subtitle' },
};

function PanelBody({ view }: { view: ActivityView }) {
  switch (view) {
    case 'explorer':
      return <ExplorerPanel />;
    case 'search':
      return <SearchPanel />;
    case 'database':
      return <DatabasePanel />;
    case 'knowledge':
      return <KnowledgePanel />;
    case 'models':
      return <ModelsPanel />;
    case 'settings':
      return <SettingsPanel />;
    default:
      return <PlaceholderPanel />;
  }
}

export function SideBar() {
  const { t } = useTranslation();
  const activeView = useUiStore((s) => s.activeView);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const meta = HEAD[activeView];

  if (!sidebarOpen) return null;

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <div>
          <div className="sidebar__title">{t(meta.titleKey, { ns: meta.titleNs })}</div>
          {meta.subKey && (
            <div className="sidebar__subtitle">{t(meta.subKey, { ns: meta.subNs })}</div>
          )}
        </div>
      </div>
      <div className="sidebar__body">
        <PanelBody view={activeView} />
      </div>
    </aside>
  );
}
