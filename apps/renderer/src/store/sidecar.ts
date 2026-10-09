import { create } from 'zustand';
import type { SidecarInfo } from '@fireeyeaud/shared';

interface SidecarState {
  info: SidecarInfo | null;
  initialized: boolean;
  init: () => Promise<void>;
}

export const useSidecarStore = create<SidecarState>((set, get) => ({
  info: null,
  initialized: false,
  init: async () => {
    if (get().initialized) return;
    const api = window.fireeyeaud;
    if (!api) {
      set({ initialized: true });
      return;
    }
    const info = await api.getSidecarInfo();
    set({ info, initialized: true });
    api.onSidecarStatus((next) => set({ info: next }));
  },
}));
