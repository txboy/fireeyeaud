/// <reference types="vite/client" />

import type { AppInfo, SearchOptions, SearchResult, SidecarInfo } from '@fireeyeaud/shared';

declare global {
  interface Window {
    fireeyeaud?: {
      getSidecarInfo: () => Promise<SidecarInfo>;
      getAppInfo: () => Promise<AppInfo>;
      openFolder: () => Promise<string | null>;
      openFiles: () => Promise<string[]>;
      searchRun: (payload: {
        root: string;
        query: string;
        options?: SearchOptions;
      }) => Promise<SearchResult>;
      onSidecarStatus: (callback: (info: SidecarInfo) => void) => () => void;
    };
  }
}

export {};
