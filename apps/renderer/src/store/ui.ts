import { create } from 'zustand';
import type { ActivityView } from '@fireeyeaud/shared';

export type ResultsTab = 'findings' | 'graph' | 'working-paper' | 'evidence';

interface UiState {
  activeView: ActivityView;
  sidebarOpen: boolean;
  resultsTab: ResultsTab;
  setActiveView: (view: ActivityView) => void;
  setResultsTab: (tab: ResultsTab) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeView: 'explorer',
  sidebarOpen: true,
  resultsTab: 'findings',
  setActiveView: (view) =>
    set((state) => ({
      activeView: view,
      sidebarOpen: state.activeView === view ? !state.sidebarOpen : true,
    })),
  setResultsTab: (tab) => set({ resultsTab: tab }),
}));
