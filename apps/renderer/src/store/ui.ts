import { create } from 'zustand';
import type { ActivityView } from '@fireeyeaud/shared';

export type ResultsTab = 'findings' | 'graph' | 'working-paper' | 'evidence';

/** 右侧区常驻「会话」tab（对话栏 + 成果栏一体）。 */
export interface SessionTab {
  id: 'session';
  kind: 'session';
}

/** 右侧区「预览」tab（每个文件一个，可多开、可关闭）。 */
export interface PreviewTab {
  id: string;
  kind: 'preview';
  root: string;
  path: string;
  name: string;
}

export type RightTab = SessionTab | PreviewTab;

const SESSION_TAB: SessionTab = { id: 'session', kind: 'session' };

interface UiState {
  activeView: ActivityView;
  sidebarOpen: boolean;
  resultsTab: ResultsTab;
  selectedFindingId: string | null;
  rightTabs: RightTab[];
  activeRightTabId: string;
  setActiveView: (view: ActivityView) => void;
  setResultsTab: (tab: ResultsTab) => void;
  setSelectedFindingId: (id: string | null) => void;
  openPreview: (root: string, absPath: string, name: string) => void;
  closeRightTab: (id: string) => void;
  activateRightTab: (id: string) => void;
  showSession: () => void;
  resetRightTabs: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  activeView: 'explorer',
  sidebarOpen: true,
  resultsTab: 'findings',
  selectedFindingId: null,
  rightTabs: [SESSION_TAB],
  activeRightTabId: 'session',

  setActiveView: (view) =>
    set((state) => ({
      activeView: view,
      sidebarOpen: state.activeView === view ? !state.sidebarOpen : true,
    })),
  setResultsTab: (tab) => set({ resultsTab: tab }),
  setSelectedFindingId: (id) => set({ selectedFindingId: id }),

  openPreview: (root, absPath, name) => {
    const id = `preview:${absPath}`;
    set((state) => {
      const exists = state.rightTabs.some((tab) => tab.id === id);
      const rightTabs = exists
        ? state.rightTabs
        : [...state.rightTabs, { id, kind: 'preview' as const, root, path: absPath, name }];
      return { rightTabs, activeRightTabId: id };
    });
  },

  closeRightTab: (id) => {
    const { rightTabs, activeRightTabId } = get();
    if (id === 'session') return;
    const index = rightTabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const next = rightTabs.filter((tab) => tab.id !== id);
    let active = activeRightTabId;
    if (activeRightTabId === id) {
      active = (next[index - 1] ?? next[index] ?? next[0] ?? SESSION_TAB).id;
    }
    set({ rightTabs: next, activeRightTabId: active });
  },

  activateRightTab: (id) => set({ activeRightTabId: id }),
  showSession: () => set({ activeRightTabId: 'session' }),
  resetRightTabs: () =>
    set({ rightTabs: [SESSION_TAB], activeRightTabId: 'session' }),
}));
