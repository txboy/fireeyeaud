import { create } from 'zustand';

export interface DbSqlStep {
  callId: string;
  tool: string;
  /** 模型请求预览的表名。 */
  table: string;
  /** 结果尚未返回。 */
  pending: boolean;
  ok?: boolean;
  summary?: string;
  messageKey?: string;
  /** 失败原因分类（不在白名单 / 单轮调用超限）。 */
  reason?: 'notAllowed' | 'tooMany';
  /** 成功时的样本规模，用于本地化展示。 */
  rows?: number;
  columnsCount?: number;
}

export interface DbSqlMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  interrupted?: boolean;
  /** 本轮模型读取样本行的步骤（tool_call / tool_result）。 */
  steps?: DbSqlStep[];
}

export interface DbSqlThread {
  open: boolean;
  messages: DbSqlMessage[];
  busy: boolean;
  errorKey: string | null;
}

interface DbSqlAssistantState {
  threads: Record<string, DbSqlThread>;
  setOpen: (tabId: string, open: boolean) => void;
  appendUser: (tabId: string, content: string) => DbSqlMessage;
  startAssistant: (tabId: string) => DbSqlMessage;
  appendDelta: (tabId: string, messageId: string, delta: string) => void;
  appendToolCall: (
    tabId: string,
    messageId: string,
    step: { callId: string; tool: string; table: string },
  ) => void;
  finishToolCall: (
    tabId: string,
    messageId: string,
    step: {
      callId: string;
      ok: boolean;
      summary: string;
      messageKey?: string;
      reason?: 'notAllowed' | 'tooMany';
      rows?: number;
      columnsCount?: number;
    },
  ) => void;
  finish: (tabId: string, messageId: string, interrupted?: boolean) => void;
  fail: (tabId: string, messageId: string, errorKey: string) => void;
  clearThread: (tabId: string) => void;
  clearAll: () => void;
  /** 中断某个 tab 进行中的生成（关闭面板 / 切换 tab 时用），不删除历史。 */
  abortThread: (tabId: string) => void;
}

/** 进行中的请求：模块级 Map，不进 zustand state（AbortController 不应触发重渲染）。 */
const controllers = new Map<string, AbortController>();

let counter = 0;
const nextId = () => `q_${Date.now().toString(36)}_${(counter += 1)}`;

const EMPTY_THREAD: DbSqlThread = {
  open: false,
  messages: [],
  busy: false,
  errorKey: null,
};

/**
 * SQL 助手线程（按 tab 独立）。仅内存态：应用重启或切换工作区即清空。
 * 关闭面板只改 `open`，不动消息，重新打开可继续。
 */
export const useDbSqlAssistantStore = create<DbSqlAssistantState>((set) => {
  const update = (tabId: string, fn: (thread: DbSqlThread) => DbSqlThread) => {
    set((state) => {
      const current = state.threads[tabId] ?? EMPTY_THREAD;
      return { threads: { ...state.threads, [tabId]: fn(current) } };
    });
  };

  return {
    threads: {},

    setOpen: (tabId, open) => update(tabId, (thread) => ({ ...thread, open })),

    appendUser: (tabId, content) => {
      const message: DbSqlMessage = {
        id: nextId(),
        role: 'user',
        content,
        createdAt: Date.now(),
      };
      update(tabId, (thread) => ({
        ...thread,
        messages: [...thread.messages, message],
        errorKey: null,
      }));
      return message;
    },

    startAssistant: (tabId) => {
      const message: DbSqlMessage = {
        id: nextId(),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };
      update(tabId, (thread) => ({
        ...thread,
        messages: [...thread.messages, message],
        busy: true,
        errorKey: null,
      }));
      return message;
    },

    appendDelta: (tabId, messageId, delta) =>
      update(tabId, (thread) => ({
        ...thread,
        messages: thread.messages.map((m) =>
          m.id === messageId ? { ...m, content: m.content + delta } : m,
        ),
      })),

    appendToolCall: (tabId, messageId, step) =>
      update(tabId, (thread) => ({
        ...thread,
        messages: thread.messages.map((m) =>
          m.id === messageId
            ? {
                ...m,
                steps: [
                  ...(m.steps ?? []),
                  { ...step, pending: true },
                ],
              }
            : m,
        ),
      })),

    finishToolCall: (tabId, messageId, step) =>
      update(tabId, (thread) => ({
        ...thread,
        messages: thread.messages.map((m) =>
          m.id === messageId
            ? {
                ...m,
                steps: (m.steps ?? []).map((s) =>
                  s.callId === step.callId
                    ? {
                        ...s,
                        pending: false,
                        ok: step.ok,
                        summary: step.summary,
                        ...(step.messageKey ? { messageKey: step.messageKey } : {}),
                        ...(step.reason ? { reason: step.reason } : {}),
                        ...(step.rows != null ? { rows: step.rows } : {}),
                        ...(step.columnsCount != null
                          ? { columnsCount: step.columnsCount }
                          : {}),
                      }
                    : s,
                ),
              }
            : m,
        ),
      })),

    finish: (tabId, messageId, interrupted = false) =>
      update(tabId, (thread) => {
        // 已被清空 / 换轮的旧请求：收尾必须无操作，否则会清掉新请求的 busy。
        if (!thread.messages.some((m) => m.id === messageId)) return thread;
        return {
          ...thread,
          busy: false,
          messages: thread.messages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  ...(interrupted ? { interrupted: true } : {}),
                  // 中断时把仍未返回的步骤收尾，避免永远显示「正在读取…」
                  ...(interrupted && m.steps
                    ? {
                        steps: m.steps.map((s) =>
                          s.pending ? { ...s, pending: false, ok: false } : s,
                        ),
                      }
                    : {}),
                }
              : m,
          ),
        };
      }),

    fail: (tabId, messageId, errorKey) =>
      update(tabId, (thread) => {
        const target = thread.messages.find((m) => m.id === messageId);
        if (!target) return thread;
        // 失败且没有任何内容的助手气泡会留下一个空回复；把它移除，错误单独展示。
        // 但已经读过样本（有 steps）的记录必须保留。
        const empty = target.role === 'assistant' && !target.content && !target.steps?.length;
        return {
          ...thread,
          busy: false,
          errorKey,
          messages: empty
            ? thread.messages.filter((m) => m.id !== messageId)
            : thread.messages,
        };
      }),

    clearThread: (tabId) => {
      controllers.get(tabId)?.abort();
      controllers.delete(tabId);
      set((state) => {
        const current = state.threads[tabId];
        const { [tabId]: _dropped, ...others } = state.threads;
        return {
          threads: current
          ? { ...others, [tabId]: { ...EMPTY_THREAD, open: current.open } }
          : others,
        };
      });
    },

    clearAll: () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      set({ threads: {} });
    },

    abortThread: (tabId) => {
      controllers.get(tabId)?.abort();
      controllers.delete(tabId);
    },
  };
});

/** 读取某个 tab 的线程（无则返回默认空线程）。 */
export function getThread(tabId: string): DbSqlThread {
  return useDbSqlAssistantStore.getState().threads[tabId] ?? EMPTY_THREAD;
}

/** 登记进行中的请求，供清空 / 关闭面板时中断。 */
export function abortThread(tabId: string, controller: AbortController): void {
  controllers.set(tabId, controller);
}

/** 请求结束后注销（避免清空时中断已完成的请求）。 */
export function releaseThread(tabId: string, controller: AbortController): void {
  if (controllers.get(tabId) === controller) controllers.delete(tabId);
}