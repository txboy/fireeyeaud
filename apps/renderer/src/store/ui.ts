import { create } from 'zustand';
import type { ActivityView } from '@fireeyeaud/shared';

export type ResultsTab = 'findings' | 'graph' | 'working-paper' | 'evidence';

interface UiState {
  activeView: ActivityView;
  sidebarOpen: boolean;
  resultsTab: ResultsTab;
  selectedFindingId: string | null;
  setActiveView: (view: ActivityView) => void;
  setResultsTab: (tab: ResultsTab) => void;
  setSelectedFindingId: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeView: 'explorer',
  sidebarOpen: true,
  resultsTab: 'findings',
  selectedFindingId: null,
  setActiveView: (view) =>
    set((state) => ({
      activeView: view,
      sidebarOpen: state.activeView === view ? !state.sidebarOpen : true,
    })),
  setResultsTab: (tab) => set({ resultsTab: tab }),
  setSelectedFindingId: (id) => set({ selectedFindingId: id }),
}));
