/// <reference types="vite/client" />

import type { AppInfo, FsEntry, SearchOptions, SearchResult, SidecarInfo } from '@fireeyeaud/shared';

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
      readDir: (payload: { root: string; dir: string }) => Promise<{ entries: FsEntry[] }>;
      openPath: (filePath: string) => Promise<{ ok: boolean }>;
      showItemInFolder: (filePath: string) => Promise<{ ok: boolean }>;
      putSecret: (plaintext: string) => Promise<string | null>;
      deleteSecret: (ref: string) => Promise<{ ok: boolean }>;
      minimizeWindow: () => Promise<void>;
      toggleMaximizeWindow: () => Promise<boolean>;
      closeWindow: () => Promise<void>;
      isWindowMaximized: () => Promise<boolean>;
      onWindowMaximized: (callback: (maximized: boolean) => void) => () => void;
      onSidecarStatus: (callback: (info: SidecarInfo) => void) => () => void;
    };
  }
}

export {};
