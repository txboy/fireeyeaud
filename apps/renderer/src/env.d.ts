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
      openPath: (filePath: string) => Promise<{ ok: boolean }>;
      showItemInFolder: (filePath: string) => Promise<{ ok: boolean }>;
      putSecret: (plaintext: string) => Promise<string | null>;
      deleteSecret: (ref: string) => Promise<{ ok: boolean }>;
      onSidecarStatus: (callback: (info: SidecarInfo) => void) => () => void;
    };
  }
}

export {};
