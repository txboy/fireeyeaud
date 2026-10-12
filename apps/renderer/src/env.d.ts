/// <reference types="vite/client" />

import type { AppInfo, FsEntry, FsFileContent, FsWriteResult, SearchOptions, SearchResult, SidecarInfo } from '@fireeyeaud/shared';

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
      readFile: (payload: { root: string; path: string }) => Promise<FsFileContent>;
      writeTextFile: (payload: { root: string; path: string; text: string }) => Promise<FsWriteResult>;
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
