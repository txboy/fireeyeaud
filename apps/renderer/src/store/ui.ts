import { create } from 'zustand';
import type { ActivityView, ConfigScope } from '@fireeyeaud/shared';

export type ResultsTab = 'findings' | 'graph' | 'working-paper' | 'evidence';

/** 右侧区常驻「会话」tab（对话栏 + 成果栏一体）。 */
export interface SessionTab {
  id: 'session';
  kind: 'session';
}

/** 右侧区「预览」tab（每个文件一个，可多开、可关闭）。 */
export interface PreviewTab {
  id: string;
  kind: 'preview';
  root: string;
  path: string;
  name: string;
}

/** 配置表单所属域。 */
export type FormDomain = 'database' | 'knowledge' | 'mcp' | 'skills' | 'models';

/** 右侧区「配置表单」tab（每个实体一个，可多开、可关闭）。 */
export interface FormTab {
  id: string;
  kind: 'form';
  domain: FormDomain;
  mode: 'create' | 'edit';
  entityId?: string;
  scope?: ConfigScope;
  /** 编辑时用于标题展示的名称。 */
  name?: string;
}

export type RightTab = SessionTab | PreviewTab | FormTab;

const SESSION_TAB: SessionTab = { id: 'session', kind: 'session' };

/**
 * 离开当前右侧 tab 前的守卫（用于未保存确认）。
 * 由当前挂载的「预览」/「配置表单」tab 注册；返回 true 表示允许离开。
 */
type LeaveGuard = () => Promise<boolean>;

let leaveGuard: LeaveGuard | null = null;

/** 注册/清除右侧 tab 离开守卫（仅当前激活 tab 的内容调用）。 */
export function setLeaveGuard(guard: LeaveGuard | null): void {
  leaveGuard = guard;
}

interface UiState {
  activeView: ActivityView;
  sidebarOpen: boolean;
  resultsTab: ResultsTab;
  selectedFindingId: string | null;
  rightTabs: RightTab[];
  activeRightTabId: string;
  setActiveView: (view: ActivityView) => void;
  setResultsTab: (tab: ResultsTab) => void;
  setSelectedFindingId: (id: string | null) => void;
  openPreview: (root: string, absPath: string, name: string) => Promise<void>;
  openForm: (
    domain: FormDomain,
    mode: 'create' | 'edit',
    entity?: { id: string; scope: ConfigScope; name: string },
  ) => Promise<void>;
  closeRightTab: (id: string) => Promise<void>;
  activateRightTab: (id: string) => Promise<void>;
  showSession: () => Promise<void>;
  resetRightTabs: () => void;
}

export const useUiStore = create<UiState>((set, get) => {
  /** 切换到 targetId 前征询当前 tab 的离开守卫。 */
  const allowLeave = async (targetId: string): Promise<boolean> => {
    if (targetId === get().activeRightTabId || !leaveGuard) return true;
    return leaveGuard();
  };

  return {
    activeView: 'explorer',
    sidebarOpen: true,
    resultsTab: 'findings',
    selectedFindingId: null,
    rightTabs: [SESSION_TAB],
    activeRightTabId: 'session',

    setActiveView: (view) =>
      set((state) => ({
        activeView: view,
        sidebarOpen: state.activeView === view ? !state.sidebarOpen : true,
      })),
    setResultsTab: (tab) => set({ resultsTab: tab }),
    setSelectedFindingId: (id) => set({ selectedFindingId: id }),

    openPreview: async (root, absPath, name) => {
      const id = `preview:${absPath}`;
      if (!(await allowLeave(id))) return;
      set((state) => {
        const exists = state.rightTabs.some((tab) => tab.id === id);
        const rightTabs = exists
          ? state.rightTabs
          : [...state.rightTabs, { id, kind: 'preview' as const, root, path: absPath, name }];
        return { rightTabs, activeRightTabId: id };
      });
    },

    openForm: async (domain, mode, entity) => {
      const key = mode === 'edit' && entity ? entity.id : 'new';
      const id = `form:${domain}:${key}`;
      if (!(await allowLeave(id))) return;
      const tab: FormTab = {
        id,
        kind: 'form',
        domain,
        mode,
        entityId: entity?.id,
        scope: entity?.scope,
        name: entity?.name,
      };
      set((state) => {
        const exists = state.rightTabs.some((t) => t.id === id);
        const rightTabs = exists
          ? state.rightTabs.map((t) => (t.id === id ? tab : t))
          : [...state.rightTabs, tab];
        return { rightTabs, activeRightTabId: id };
      });
    },

    closeRightTab: async (id) => {
      if (id === 'session') return;
      const { rightTabs, activeRightTabId } = get();
      const index = rightTabs.findIndex((tab) => tab.id === id);
      if (index === -1) return;
      if (id === activeRightTabId && !(await allowLeave('__close__'))) return;
      const next = rightTabs.filter((tab) => tab.id !== id);
      let active = activeRightTabId;
      if (activeRightTabId === id) {
        active = (next[index - 1] ?? next[index] ?? next[0] ?? SESSION_TAB).id;
      }
      set({ rightTabs: next, activeRightTabId: active });
    },

    activateRightTab: async (id) => {
      if (!(await allowLeave(id))) return;
      set({ activeRightTabId: id });
    },

    showSession: async () => {
      if (!(await allowLeave('session'))) return;
      set({ activeRightTabId: 'session' });
    },

    resetRightTabs: () =>
      set({ rightTabs: [SESSION_TAB], activeRightTabId: 'session' }),
  };
});
