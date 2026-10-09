/// <reference types="vite/client" />

import type { AppInfo, SidecarInfo } from '@fireeyeaud/shared';

declare global {
  interface Window {
    fireeyeaud?: {
      getSidecarInfo: () => Promise<SidecarInfo>;
      getAppInfo: () => Promise<AppInfo>;
      openFolder: () => Promise<string | null>;
      onSidecarStatus: (callback: (info: SidecarInfo) => void) => () => void;
    };
  }
}

export {};
