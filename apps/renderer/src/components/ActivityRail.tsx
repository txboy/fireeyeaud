import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Cpu,
  Database,
  FolderTree,
  Moon,
  Plug,
  Search,
  Settings,
  Sparkles,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityView } from '@fireeyeaud/shared';
import { useUiStore } from '../store/ui';
import { useSettingsStore } from '../store/settings';

interface RailItem {
  view: ActivityView;
  icon: LucideIcon;
  labelKey: string;
}

const TOP_ITEMS: RailItem[] = [
  { view: 'explorer', icon: FolderTree, labelKey: 'explorer' },
  { view: 'search', icon: Search, labelKey: 'search' },
  { view: 'database', icon: Database, labelKey: 'database' },
  { view: 'knowledge', icon: BookOpen, labelKey: 'knowledge' },
  { view: 'mcp', icon: Plug, labelKey: 'mcp' },
  { view: 'skills', icon: Sparkles, labelKey: 'skills' },
  { view: 'models', icon: Cpu, labelKey: 'models' },
];

export function ActivityRail() {
  const { t } = useTranslation('navigation');
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const openSettings = useUiStore((s) => s.openSettings);
  const settingsActive = useUiStore((s) =>
    s.rightTabs.some((tab) => tab.kind === 'settings' && tab.id === s.activeRightTabId),
  );
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <nav className="activitybar" aria-label="activity bar">
      {TOP_ITEMS.map(({ view, icon: Icon, labelKey }) => (
        <button
          key={view}
          type="button"
          title={t(labelKey)}
          aria-label={t(labelKey)}
          className={`activitybar__item${activeView === view ? ' activitybar__item--active' : ''}`}
          onClick={() => setActiveView(view)}
        >
          <Icon size={18} strokeWidth={1.75} />
        </button>
      ))}

      <span className="spacer" />

      <button
        type="button"
        title={t('theme')}
        aria-label={t('theme')}
        className="activitybar__item"
        onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      >
        {theme === 'light' ? <Moon size={18} strokeWidth={1.75} /> : <Sun size={18} strokeWidth={1.75} />}
      </button>
      <button
        type="button"
        title={t('settings')}
        aria-label={t('settings')}
        className={`activitybar__item${settingsActive ? ' activitybar__item--active' : ''}`}
        onClick={() => void openSettings()}
      >
        <Settings size={18} strokeWidth={1.75} />
      </button>
    </nav>
  );
}
