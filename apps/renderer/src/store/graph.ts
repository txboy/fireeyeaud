import { create } from 'zustand';
import type { GraphData, GraphNode } from '@fireeyeaud/shared';
import { getGraph } from '../lib/api';
import { errorKeyOf } from '../lib/errorKey';

interface GraphState {
  data: GraphData;
  selectedNode: GraphNode | null;
  loading: boolean;
  errorKey: string | null;
  load: (findingId?: string) => Promise<void>;
  selectNode: (node: GraphNode | null) => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  data: { nodes: [], edges: [] },
  selectedNode: null,
  loading: false,
  errorKey: null,
  load: async (findingId) => {
    set({ loading: true, errorKey: null });
    try {
      const data = await getGraph(findingId);
      set({ data, loading: false });
    } catch (err) {
      set({
        loading: false,
        errorKey: errorKeyOf(err),
      });
    }
  },
  selectNode: (node) => set({ selectedNode: node }),
}));
