import { create } from 'zustand';
import type { SseEvent } from '@fireeyeaud/shared';
import {
  ApiError,
  createSessionApi,
  deleteSessionApi,
  EMPTY_CONTEXT,
  getSessionMessagesApi,
  listSessionsApi,
  renameSessionApi,
  streamChat,
  type AttachmentRef,
  type ChatContext,
  type SessionMessage,
  type SessionSummary,
} from '../lib/api';
import { useFindingsStore } from './findings';

export type ChatRole = 'user' | 'assistant';

export interface ToolCall {
  callId: string;
  tool: string;
  params: Record<string, unknown>;
  summary?: string;
  ok?: boolean;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  thinking: string;
  phase: string | null;
  streaming: boolean;
  errorKey: string | null;
  tools: ToolCall[];
  findingIds: string[];
}

interface ChatState {
  sessionId: string | null;
  sessions: SessionSummary[];
  messages: ChatMessage[];
  streaming: boolean;
  /** 当前会话使用的模型档案 id（为空表示由后端取默认模型）。 */
  modelId: string | null;
  /** 本次会话勾选的非默认资源（后端再并上默认集）。 */
  context: ChatContext;
  /** 本次会话的临时附件（不写工作区）。 */
  attachments: AttachmentRef[];
  loadSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  newSession: () => void;
  createSession: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  setModel: (id: string | null) => void;
  setContext: (patch: Partial<ChatContext>) => void;
  addAttachments: (items: AttachmentRef[]) => void;
  removeAttachment: (path: string) => void;
  send: (text: string, locale: string) => Promise<void>;
  clear: () => void;
}

let counter = 0;
const nextId = () => `m_${Date.now().toString(36)}_${(counter += 1)}`;

/** 后端存储的消息投影 → 前端 ChatMessage。 */
function toChatMessage(message: SessionMessage): ChatMessage {
  const text =
    typeof message.content === 'string'
      ? message.content
      : (message.content?.text ?? '');
  return {
    id: message.id,
    role: message.role === 'user' ? 'user' : 'assistant',
    content: text,
    thinking: '',
    phase: null,
    streaming: false,
    errorKey: null,
    tools: [],
    findingIds: [],
  };
}

function applyEvent(message: ChatMessage, event: SseEvent): ChatMessage {
  const data = (event.data ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case 'status':
      return { ...message, phase: (data.phase as string) ?? message.phase };
    case 'thinking':
      return { ...message, thinking: String(data.text ?? '') };
    case 'token':
      return { ...message, content: message.content + String(data.delta ?? '') };
    case 'tool_call':
      return {
        ...message,
        tools: [
          ...message.tools,
          {
            callId: String(data.callId ?? ''),
            tool: String(data.tool ?? ''),
            params: (data.params as Record<string, unknown>) ?? {},
          },
        ],
      };
    case 'tool_result':
      return {
        ...message,
        tools: message.tools.map((tool) =>
          tool.callId === String(data.callId)
            ? {
                ...tool,
                summary: String(data.summary ?? ''),
                ok: Boolean(data.ok),
              }
            : tool,
        ),
      };
    case 'finding':
      return {
        ...message,
        findingIds: [...message.findingIds, String(data.id ?? '')],
      };
    case 'error':
      return {
        ...message,
        streaming: false,
        errorKey: String(data.messageKey ?? 'error.internal'),
      };
    case 'done':
      return { ...message, streaming: false, thinking: '' };
    default:
      return message;
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  sessions: [],
  messages: [],
  streaming: false,
  modelId: null,
  context: EMPTY_CONTEXT,
  attachments: [],

  loadSessions: async () => {
    try {
      const page = await listSessionsApi();
      set({ sessions: page.items });
    } catch {
      /* sidecar 未就绪时忽略 */
    }
  },

  selectSession: async (id) => {
    set({
      sessionId: id,
      messages: [],
      streaming: false,
      context: EMPTY_CONTEXT,
      attachments: [],
    });
    try {
      const page = await getSessionMessagesApi(id);
      if (get().sessionId !== id) return; // 已切换到别的会话
      set({ messages: page.items.map(toChatMessage) });
    } catch (err) {
      const e = err as ApiError;
      set({
        messages: [
          {
            id: nextId(),
            role: 'assistant',
            content: '',
            thinking: '',
            phase: null,
            streaming: false,
            errorKey: e.messageKey ?? 'error.internal',
            tools: [],
            findingIds: [],
          },
        ],
      });
    }
  },

  newSession: () =>
    set({
      sessionId: null,
      messages: [],
      streaming: false,
      context: EMPTY_CONTEXT,
      attachments: [],
    }),

  // 立即在后台创建一条空会话并选中（标题留空，首条消息发送时再补标题）。
  createSession: async () => {
    try {
      const session = await createSessionApi({ title: null });
      set({
        sessionId: session.id,
        messages: [],
        streaming: false,
        context: EMPTY_CONTEXT,
        attachments: [],
      });
      await get().loadSessions();
    } catch (err) {
      const e = err as ApiError;
      set({
        sessionId: null,
        messages: [
          {
            id: nextId(),
            role: 'assistant',
            content: '',
            thinking: '',
            phase: null,
            streaming: false,
            errorKey: e.messageKey ?? 'error.sidecarNotReady',
            tools: [],
            findingIds: [],
          },
        ],
      });
    }
  },

  setModel: (id) => set({ modelId: id }),

  setContext: (patch) => set((s) => ({ context: { ...s.context, ...patch } })),

  addAttachments: (items) =>
    set((s) => {
      const known = new Set(s.attachments.map((a) => a.path));
      const added = items.filter((a) => !known.has(a.path));
      return added.length ? { attachments: [...s.attachments, ...added] } : {};
    }),

  removeAttachment: (path) =>
    set((s) => ({ attachments: s.attachments.filter((a) => a.path !== path) })),

  deleteSession: async (id) => {
    try {
      await deleteSessionApi(id);
    } catch {
      /* 忽略删除失败 */
    }
    set((s) => ({
      sessions: s.sessions.filter((item) => item.id !== id),
      ...(s.sessionId === id
        ? { sessionId: null, messages: [], context: EMPTY_CONTEXT, attachments: [] }
        : {}),
    }));
  },

  send: async (text, locale) => {
    const trimmed = text.trim();
    if (!trimmed || get().streaming) return;

    let sessionId = get().sessionId;
    try {
      if (!sessionId) {
        const session = await createSessionApi({ title: trimmed.slice(0, 40) });
        sessionId = session.id;
        set({ sessionId });
        void get().loadSessions();
      } else {
        // 「点击即建」的空会话：首条消息发送时补上标题。
        const current = get().sessions.find((s) => s.id === sessionId);
        if (current && !current.title) {
          const title = trimmed.slice(0, 40);
          set((s) => ({
            sessions: s.sessions.map((it) =>
              it.id === sessionId ? { ...it, title } : it,
            ),
          }));
          void renameSessionApi(sessionId, title).catch(() => {
            /* 标题更新失败不阻塞对话 */
          });
        }
      }
    } catch (err) {
      const e = err as ApiError;
      set((s) => ({
        messages: [
          ...s.messages,
          {
            id: nextId(),
            role: 'assistant',
            content: '',
            thinking: '',
            phase: null,
            streaming: false,
            errorKey: e.messageKey ?? 'error.sidecarNotReady',
            tools: [],
            findingIds: [],
          },
        ],
      }));
      return;
    }

    const userMessage: ChatMessage = {
      id: nextId(),
      role: 'user',
      content: trimmed,
      thinking: '',
      phase: null,
      streaming: false,
      errorKey: null,
      tools: [],
      findingIds: [],
    };
    const assistantMessage: ChatMessage = {
      id: nextId(),
      role: 'assistant',
      content: '',
      thinking: '',
      phase: null,
      streaming: true,
      errorKey: null,
      tools: [],
      findingIds: [],
    };
    set((s) => ({
      messages: [...s.messages, userMessage, assistantMessage],
      streaming: true,
    }));

    const update = (event: SseEvent) => {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessage.id ? applyEvent(m, event) : m,
        ),
        streaming:
          event.type === 'done' || event.type === 'error' ? false : s.streaming,
      }));
      if (event.type === 'finding') {
        void useFindingsStore.getState().load();
      }
    };

    try {
      await streamChat(
        sessionId,
        trimmed,
        { onEvent: update },
        locale,
        get().modelId ?? undefined,
        get().context,
        get().attachments,
      );
    } catch (err) {
      const e = err as ApiError;
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessage.id
            ? { ...m, streaming: false, errorKey: e.messageKey ?? 'error.internal' }
            : m,
        ),
        streaming: false,
      }));
    } finally {
      void get().loadSessions();
    }
  },

  clear: () =>
    set({
      sessionId: null,
      messages: [],
      streaming: false,
      context: EMPTY_CONTEXT,
      attachments: [],
    }),
}));
