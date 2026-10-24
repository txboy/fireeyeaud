import {
  getFormDocument,
  getReportDocument,
  setFormOutline,
  setReportOutline,
} from '../lib/api';
import type { WorkspaceKind } from './workspaceKind';
import { createWorkspaceStore, type WorkspaceApi } from './reportWorkspace';

/**
 * 写作台文档 store 注册表。
 * `useDocStore(kind)` 返回一个稳定的 store hook，可在组件里直接当 selector 使用
 * （内置的 useReportDocStore / useFormDocStore 反过来复用这套注册表）。
 */
const REGISTRY: Record<WorkspaceKind, ReturnType<typeof createDocStore>> = {} as never;

function createDocStore(api: WorkspaceApi) {
  const store = createWorkspaceStore(api);
  return {
    useStore: store,
    useSelector: <T>(selector: (state: ReturnType<typeof store.getState>) => T): T =>
      store(selector),
  };
}

function register(kind: WorkspaceKind) {
  const api: WorkspaceApi =
    kind === 'report'
      ? {
          get: getReportDocument,
          setOutline: (id, sections, approved) =>
            setReportOutline(id, sections, approved),
        }
      : {
          get: getFormDocument,
          setOutline: (id, sections, approved) => setFormOutline(id, sections, approved),
        };
  const entry = createDocStore(api);
  REGISTRY[kind] = entry;
  return entry;
}

/** 报告文档 store（外部仍以 useReportDocStore(selector) 使用）。 */
export const useReportDocStore = register('report').useStore;

/** 取证单文档 store。 */
export const useFormDocStore = register('evidence-form').useStore;

/** 按 kind 取 selector hook；返回值在 kind 不变时稳定。 */
export function useDocStore(kind: WorkspaceKind) {
  return REGISTRY[kind].useSelector;
}