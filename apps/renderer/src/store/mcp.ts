import { create } from 'zustand';
import type { McpServer } from '@fireeyeaud/shared';
import {
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  updateMcpServer,
  type McpServerInput,
} from '../lib/api';

interface McpState {
  items: McpServer[];
  loading: boolean;
  errorKey: string | null;
  load: () => Promise<void>;
  create: (input: McpServerInput) => Promise<boolean>;
  toggle: (id: string, scope: McpServer['scope'], enabled: boolean) => Promise<void>;
  remove: (id: string, scope: McpServer['scope']) => Promise<void>;
  reset: () => void;
}

export const useMcpStore = create<McpState>((set, get) => ({
  items: [],
  loading: false,
  errorKey: null,

  load: async () => {
    set({ loading: true, errorKey: null });
    try {
      const page = await listMcpServers();
      set({ items: page.items, loading: false });
    } catch (err) {
      set({
        loading: false,
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal',
      });
    }
  },

  create: async (input) => {
    set({ errorKey: null });
    try {
      await createMcpServer(input);
      await get().load();
      return true;
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
      return false;
    }
  },

  toggle: async (id, scope, enabled) => {
    await updateMcpServer(id, scope, { enabled });
    await get().load();
  },

  remove: async (id, scope) => {
    await deleteMcpServer(id, scope);
    await get().load();
  },

  reset: () => set({ items: [], loading: false, errorKey: null }),
}));
