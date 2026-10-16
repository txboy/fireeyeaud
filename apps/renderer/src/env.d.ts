/// <reference types="vite/client" />

import type { AppInfo, FsDeleteResult, FsEntry, FsFileContent, FsOpResult, FsWriteResult, SearchOptions, SearchResult, SidecarInfo } from '@fireeyeaud/shared';

declare global {
  interface Window {
    fireeyeaud?: {
      getSidecarInfo: () => Promise<SidecarInfo>;
      getAppInfo: () => Promise<AppInfo>;
      openFolder: () => Promise<string | null>;
      openFiles: (
        kind?: 'tables' | 'attachments' | 'all' | 'database',
        options?: { driver?: string },
      ) => Promise<string[]>;
      searchRun: (payload: {
        root: string;
        query: string;
        options?: SearchOptions;
      }) => Promise<SearchResult>;
      readDir: (payload: { root: string; dir: string }) => Promise<{ entries: FsEntry[] }>;
      readFile: (payload: { root: string; path: string }) => Promise<FsFileContent>;
      writeTextFile: (payload: { root: string; path: string; text: string }) => Promise<FsWriteResult>;
      deletePath: (payload: { root: string; path: string }) => Promise<FsDeleteResult>;
      copyFiles: (payload: {
        root: string;
        targetDir: string;
        sourcePaths: string[];
      }) => Promise<FsOpResult>;
      movePath: (payload: {
        root: string;
        sourcePath: string;
        targetDir: string;
      }) => Promise<FsOpResult>;
      createDir: (payload: { root: string; parentDir: string; name: string }) => Promise<FsOpResult>;
      createFile: (payload: { root: string; parentDir: string; name: string }) => Promise<FsOpResult>;
      renamePath: (payload: {
        root: string;
        path: string;
        newName: string;
      }) => Promise<FsOpResult>;
      getPathForFile: (file: File) => string;
      openPath: (filePath: string) => Promise<{ ok: boolean }>;
      showItemInFolder: (filePath: string) => Promise<{ ok: boolean }>;
      openExternal: (url: string) => Promise<{ ok: boolean }>;
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
