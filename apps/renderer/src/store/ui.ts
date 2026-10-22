import { create } from 'zustand';
import type {
  ActivityView,
  ConfigScope,
  DbDriver,
  DbTableSchema,
  TemplateKind,
} from '@fireeyeaud/shared';

export type ResultsTab = 'findings' | 'graph' | 'working-paper' | 'evidence';

/** 右侧区「会话」tab（对话栏 + 成果栏一体），每个会话一个。 */
export interface SessionTab {
  id: string;
  kind: 'session';
  sessionId: string;
}

/** 右侧区「预览」tab（每个文件一个，可多开、可关闭）。 */
export interface PreviewTab {
  id: string;
  kind: 'preview';
  root: string;
  path: string;
  name: string;
  /** 打开时定位到的目标行（1 基）；来自搜索结果点击。 */
  line?: number;
  /** 目标列（1 基）；越界会钳制到行内。 */
  column?: number;
}

/** 配置表单所属域。 */
export type FormDomain =
  | 'database'
  | 'knowledge'
  | 'mcp'
  | 'skills'
  | 'rules'
  | 'models'
  | 'templates';

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
  /** 模板表单：新建时选择的模板类型。 */
  templateKind?: TemplateKind;
}

/** 右侧区「设置」tab（全局单例）。 */
export interface SettingsTab {
  id: 'settings';
  kind: 'settings';
}

/** 右侧区「规则试跑」tab（每条规则一个，SQL 工作台）。 */
export interface RuleRunTab {
  id: string;
  kind: 'ruleRun';
  ruleId: string;
  name: string;
}

/** 右侧区「表授权」tab（每个数据库连接一个，表 / 字段结构 + 授权）。 */
export interface DbSchemaTab {
  id: string;
  kind: 'dbSchema';
  connectionId: string;
  scope: ConfigScope;
  name: string;
}

/** 右侧区「数据预览」tab（每个数据库连接的一张表一个，SQL 查询 + 分页结果）。 */
export interface DbDataTab {
  id: string;
  kind: 'dbData';
  connectionId: string;
  scope: ConfigScope;
  /** 连接名，tab 标题展示用。 */
  name: string;
  /** 驱动，用于默认 SQL 的标识符转义。 */
  driver: DbDriver;
  /** 表结构，用于默认 SQL 的主键排序与标识符转义。 */
  table: DbTableSchema;
}

/** 右侧区「知识库浏览」tab（每个 Provider 一个，远端知识库列表 + 勾选启用）。 */
export interface KbBrowseTab {
  id: string;
  kind: 'kbBrowse';
  providerId: string;
  scope: ConfigScope;
  name: string;
}

/** 右侧区「知识库检索测试」tab（指定 Provider 下的某个库，输入文本试检索）。 */
export interface KbQueryTab {
  id: string;
  kind: 'kbQuery';
  providerId: string;
  scope: ConfigScope;
  name: string;
  /** 预选的知识库 id；缺省时在 tab 内选择。 */
  knowledgeId?: string;
  /** 预选知识库的展示名。 */
  knowledgeName?: string;
}

export type RightTab =
  | SessionTab
  | PreviewTab
  | FormTab
  | SettingsTab
  | RuleRunTab
  | DbSchemaTab
  | DbDataTab
  | KbBrowseTab
  | KbQueryTab;

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
  openPreview: (
    root: string,
    absPath: string,
    name: string,
    target?: { line?: number; column?: number },
  ) => Promise<void>;
  openForm: (
    domain: FormDomain,
    mode: 'create' | 'edit',
    entity?: {
      id: string;
      scope: ConfigScope;
      name: string;
      templateKind?: TemplateKind;
    },
  ) => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  openSettings: () => Promise<void>;
  openRuleRun: (ruleId: string, name: string) => Promise<void>;
  openDbSchema: (input: {
    id: string;
    scope: ConfigScope;
    name: string;
  }) => Promise<void>;
  openDbData: (input: {
    id: string;
    scope: ConfigScope;
    name: string;
    driver: DbDriver;
    table: DbTableSchema;
  }) => Promise<void>;
  openKbBrowse: (input: {
    id: string;
    scope: ConfigScope;
    name: string;
  }) => Promise<void>;
  openKbQuery: (input: {
    id: string;
    scope: ConfigScope;
    name: string;
    knowledgeId?: string;
    knowledgeName?: string;
  }) => Promise<void>;
  closeRightTab: (id: string) => Promise<void>;
  activateRightTab: (id: string) => Promise<void>;
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
    rightTabs: [],
    activeRightTabId: '',

    setActiveView: (view) =>
      set((state) => ({
        activeView: view,
        sidebarOpen: state.activeView === view ? !state.sidebarOpen : true,
      })),
    setResultsTab: (tab) => set({ resultsTab: tab }),
    setSelectedFindingId: (id) => set({ selectedFindingId: id }),

    openPreview: async (root, absPath, name, target) => {
      const id = `preview:${absPath}`;
      if (!(await allowLeave(id))) return;
      const tab: PreviewTab = {
        id,
        kind: 'preview',
        root,
        path: absPath,
        name,
        line: target?.line,
        column: target?.column,
      };
      set((state) => {
        const exists = state.rightTabs.some((t) => t.id === id);
        const rightTabs = exists
          ? state.rightTabs.map((t) => (t.id === id ? tab : t))
          : [...state.rightTabs, tab];
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
        templateKind: entity?.templateKind,
      };
      set((state) => {
        const exists = state.rightTabs.some((t) => t.id === id);
        const rightTabs = exists
          ? state.rightTabs.map((t) => (t.id === id ? tab : t))
          : [...state.rightTabs, tab];
        return { rightTabs, activeRightTabId: id };
      });
    },

    openSession: async (sessionId) => {
      const id = `session:${sessionId}`;
      if (!(await allowLeave(id))) return;
      set((state) => {
        const exists = state.rightTabs.some((tab) => tab.id === id);
        const rightTabs = exists
          ? state.rightTabs
          : [...state.rightTabs, { id, kind: 'session' as const, sessionId }];
        return { rightTabs, activeRightTabId: id };
      });
    },

    openSettings: async () => {
      const tab: SettingsTab = { id: 'settings', kind: 'settings' };
      if (!(await allowLeave(tab.id))) return;
      set((state) => {
        const exists = state.rightTabs.some((t) => t.id === tab.id);
        const rightTabs = exists ? state.rightTabs : [...state.rightTabs, tab];
        return { rightTabs, activeRightTabId: tab.id };
      });
    },

    openRuleRun: async (ruleId, name) => {
      const id = `ruleRun:${ruleId}`;
      if (!(await allowLeave(id))) return;
      const tab: RuleRunTab = { id, kind: 'ruleRun', ruleId, name };
      set((state) => {
        const exists = state.rightTabs.some((t) => t.id === id);
        const rightTabs = exists
          ? state.rightTabs.map((t) => (t.id === id ? tab : t))
          : [...state.rightTabs, tab];
        return { rightTabs, activeRightTabId: id };
      });
    },

    openDbSchema: async ({ id: connId, scope, name }) => {
      const id = `dbSchema:${connId}`;
      if (!(await allowLeave(id))) return;
      const tab: DbSchemaTab = {
        id,
        kind: 'dbSchema',
        connectionId: connId,
        scope,
        name,
      };
      set((state) => {
        const exists = state.rightTabs.some((t) => t.id === id);
        const rightTabs = exists
          ? state.rightTabs.map((t) => (t.id === id ? tab : t))
          : [...state.rightTabs, tab];
        return { rightTabs, activeRightTabId: id };
      });
    },

    openDbData: async ({ id: connId, scope, name, driver, table }) => {
      const id = `dbData:${connId}:${table.table}`;
      if (!(await allowLeave(id))) return;
      const tab: DbDataTab = {
        id,
        kind: 'dbData',
        connectionId: connId,
        scope,
        name,
        driver,
        table,
      };
      set((state) => {
        const exists = state.rightTabs.some((t) => t.id === id);
        const rightTabs = exists
          ? state.rightTabs.map((t) => (t.id === id ? tab : t))
          : [...state.rightTabs, tab];
        return { rightTabs, activeRightTabId: id };
      });
    },

    openKbBrowse: async ({ id: providerId, scope, name }) => {
      const id = `kbBrowse:${providerId}`;
      if (!(await allowLeave(id))) return;
      const tab: KbBrowseTab = {
        id,
        kind: 'kbBrowse',
        providerId,
        scope,
        name,
      };
      set((state) => {
        const exists = state.rightTabs.some((t) => t.id === id);
        const rightTabs = exists
          ? state.rightTabs.map((t) => (t.id === id ? tab : t))
          : [...state.rightTabs, tab];
        return { rightTabs, activeRightTabId: id };
      });
    },

    openKbQuery: async ({
      id: providerId,
      scope,
      name,
      knowledgeId,
      knowledgeName,
    }) => {
      const id = knowledgeId
        ? `kbQuery:${providerId}:${knowledgeId}`
        : `kbQuery:${providerId}`;
      if (!(await allowLeave(id))) return;
      const tab: KbQueryTab = {
        id,
        kind: 'kbQuery',
        providerId,
        scope,
        name,
        knowledgeId,
        knowledgeName,
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
      const { rightTabs, activeRightTabId } = get();
      const index = rightTabs.findIndex((tab) => tab.id === id);
      if (index === -1) return;
      if (id === activeRightTabId && !(await allowLeave('__close__'))) return;
      const next = rightTabs.filter((tab) => tab.id !== id);
      let active = activeRightTabId;
      if (activeRightTabId === id) {
        active = (next[index - 1] ?? next[index] ?? next[0])?.id ?? '';
      }
      set({ rightTabs: next, activeRightTabId: active });
    },

    activateRightTab: async (id) => {
      if (!(await allowLeave(id))) return;
      set({ activeRightTabId: id });
    },

    resetRightTabs: () => set({ rightTabs: [], activeRightTabId: '' }),
  };
});
