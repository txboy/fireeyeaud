import { create } from 'zustand';
import type { SseEvent } from '@fireeyeaud/shared';
import {
  ApiError,
  createSessionApi,
  deleteSessionApi,
  getSessionMessagesApi,
  listSessionsApi,
  streamChat,
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
  loadSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  newSession: () => void;
  deleteSession: (id: string) => Promise<void>;
  setModel: (id: string | null) => void;
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

  loadSessions: async () => {
    try {
      const page = await listSessionsApi();
      set({ sessions: page.items });
    } catch {
      /* sidecar 未就绪时忽略 */
    }
  },

  selectSession: async (id) => {
    set({ sessionId: id, messages: [] });
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

  newSession: () => set({ sessionId: null, messages: [] }),

  setModel: (id) => set({ modelId: id }),

  deleteSession: async (id) => {
    try {
      await deleteSessionApi(id);
    } catch {
      /* 忽略删除失败 */
    }
    set((s) => ({
      sessions: s.sessions.filter((item) => item.id !== id),
      ...(s.sessionId === id ? { sessionId: null, messages: [] } : {}),
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

  clear: () => set({ sessionId: null, messages: [], streaming: false }),
}));
