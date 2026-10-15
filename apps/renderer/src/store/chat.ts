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
  updateSessionContextApi,
  type AttachmentRef,
  type ChatContext,
  type ContextSnapshot,
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
  /** 该条用户消息发送时带给模型的勾选项（默认项不含），助手消息为 null。 */
  options: ContextSnapshot | null;
}

/**
 * 单个会话的完整聊天状态。按会话 id 分片存放，切换右侧 tab 不丢失内容，
 * 多个会话可同时进行（后台生成）。
 */
export interface SessionChat {
  messages: ChatMessage[];
  streaming: boolean;
  modelId: string | null;
  context: ChatContext;
  attachments: AttachmentRef[];
  /** 输入框草稿（随会话保留）。 */
  draft: string;
  /** 是否已从后端加载过消息，避免重复拉取并覆盖进行中的流。 */
  loaded: boolean;
}

interface ChatState {
  sessions: SessionSummary[];
  /** 各会话的聊天分片，key 为会话 id。 */
  chats: Record<string, SessionChat>;
  loadSessions: () => Promise<void>;
  loadMessages: (sessionId: string) => Promise<void>;
  /** 新建一条空会话，返回其 id（失败返回 null）。 */
  createSession: () => Promise<string | null>;
  deleteSession: (sessionId: string) => Promise<void>;
  send: (sessionId: string, text: string, locale: string) => Promise<void>;
  /** 中止单个会话的后台生成（保留已生成部分）。 */
  abortSession: (sessionId: string) => void;
  /** 中止所有会话的后台生成。 */
  abortAll: () => void;
  hasStreaming: () => boolean;
  setModel: (sessionId: string, modelId: string | null) => void;
  setContext: (sessionId: string, patch: Partial<ChatContext>) => void;
  addAttachments: (sessionId: string, items: AttachmentRef[]) => void;
  removeAttachment: (sessionId: string, path: string) => void;
  setDraft: (sessionId: string, text: string) => void;
  /** 清空所有聊天分片（切换工作区时）。 */
  clearAllChats: () => void;
}

let counter = 0;
const nextId = () => `m_${Date.now().toString(36)}_${(counter += 1)}`;

/** 每个进行中的会话对应一个 AbortController（模块级，不进 store state）。 */
const controllers = new Map<string, AbortController>();

/** 会话级上下文（勾选资源 + 模型）回写后端的去抖定时器。 */
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 去抖地把某会话的上下文与模型回写后端，重开会话后可恢复。 */
function persistSessionContext(sessionId: string): void {
  const existing = persistTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  persistTimers.set(
    sessionId,
    setTimeout(() => {
      persistTimers.delete(sessionId);
      const chat = useChatStore.getState().chats[sessionId];
      // 会话尚未加载（可能正在从后端恢复上下文）时不要回写，避免覆盖已存值。
      if (!chat || !chat.loaded) return;
      void updateSessionContextApi(sessionId, {
        context: chat.context,
        modelId: chat.modelId,
      }).catch(() => {
        /* sidecar 未就绪时忽略 */
      });
    }, 400),
  );
}

function newChat(): SessionChat {
  return {
    messages: [],
    streaming: false,
    modelId: null,
    context: { ...EMPTY_CONTEXT },
    attachments: [],
    draft: '',
    loaded: false,
  };
}

/** 不可变地更新某个会话分片（不存在则新建）。 */
function withChat(
  chats: Record<string, SessionChat>,
  sessionId: string,
  fn: (chat: SessionChat) => SessionChat,
): Record<string, SessionChat> {
  return { ...chats, [sessionId]: fn(chats[sessionId] ?? newChat()) };
}

function assistantError(messageKey: string): ChatMessage {
  return {
    id: nextId(),
    role: 'assistant',
    content: '',
    thinking: '',
    phase: null,
    streaming: false,
    errorKey: messageKey,
    tools: [],
    findingIds: [],
    options: null,
  };
}

/** 后端存储的消息投影 → 前端 ChatMessage。 */
function toChatMessage(message: SessionMessage): ChatMessage {
  const text =
    typeof message.content === 'string'
      ? message.content
      : (message.content?.text ?? '');
  const options =
    typeof message.content === 'string' || !message.content
      ? null
      : (message.content.options ?? null);
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
    options,
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
  sessions: [],
  chats: {},

  loadSessions: async () => {
    try {
      const page = await listSessionsApi();
      set({ sessions: page.items });
    } catch {
      /* sidecar 未就绪时忽略 */
    }
  },

  loadMessages: async (sessionId) => {
    if (get().chats[sessionId]?.loaded) return;
    // 会话列表携带会话级上下文；若尚未加载则先拉取，重开会话时恢复勾选。
    if (get().sessions.length === 0) await get().loadSessions();
    const meta = get().sessions.find((s) => s.id === sessionId);
    try {
      const page = await getSessionMessagesApi(sessionId);
      set((s) => ({
        chats: withChat(s.chats, sessionId, (chat) => ({
          ...chat,
          // 若加载期间已开始流式生成，则不覆盖进行中的内容。
          messages: chat.streaming ? chat.messages : page.items.map(toChatMessage),
          modelId:
            !chat.streaming && meta?.modelId ? meta.modelId : chat.modelId,
          context:
            !chat.streaming && meta?.context
              ? { ...EMPTY_CONTEXT, ...meta.context }
              : chat.context,
          loaded: true,
        })),
      }));
      // 加载完成后回写一次：覆盖「加载前用户已改动」的窗口，且此时 hydrated 值已就位。
      persistSessionContext(sessionId);
    } catch (err) {
      const e = err as ApiError;
      set((s) => ({
        chats: withChat(s.chats, sessionId, (chat) => ({
          ...chat,
          messages: [assistantError(e.messageKey ?? 'error.internal')],
          loaded: true,
        })),
      }));
    }
  },

  createSession: async () => {
    try {
      const session = await createSessionApi({ title: null });
      set((s) => ({ chats: { ...s.chats, [session.id]: newChat() } }));
      await get().loadSessions();
      return session.id;
    } catch {
      return null;
    }
  },

  deleteSession: async (sessionId) => {
    get().abortSession(sessionId);
    try {
      await deleteSessionApi(sessionId);
    } catch {
      /* 忽略删除失败 */
    }
    set((s) => {
      const chats = { ...s.chats };
      delete chats[sessionId];
      return { sessions: s.sessions.filter((item) => item.id !== sessionId), chats };
    });
  },

  send: async (sessionId, text, locale) => {
    const trimmed = text.trim();
    const current = get().chats[sessionId];
    if (!trimmed || current?.streaming) return;

    // 若该会话还没有标题，用首条消息补上。
    const meta = get().sessions.find((s) => s.id === sessionId);
    if (meta && !meta.title) {
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
      options: null,
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
      options: null,
    };
    set((s) => ({
      chats: withChat(s.chats, sessionId, (chat) => ({
        ...chat,
        messages: [...chat.messages, userMessage, assistantMessage],
        streaming: true,
        draft: '',
      })),
    }));

    const controller = new AbortController();
    controllers.set(sessionId, controller);
    const chat = get().chats[sessionId];

    const update = (event: SseEvent) => {
      // 上下文快照事件挂在刚发出的用户消息上（后端为唯一数据源）。
      if (event.type === 'context') {
        const snapshot = ((event.data ?? {}) as { options?: ContextSnapshot | null })
          .options ?? null;
        set((s) => ({
          chats: withChat(s.chats, sessionId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === userMessage.id ? { ...m, options: snapshot } : m,
            ),
          })),
        }));
        return;
      }
      set((s) => {
        if (!s.chats[sessionId]) return s;
        return {
          chats: withChat(s.chats, sessionId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantMessage.id ? applyEvent(m, event) : m,
            ),
            streaming:
              event.type === 'done' || event.type === 'error' ? false : c.streaming,
          })),
        };
      });
      if (event.type === 'finding') {
        void useFindingsStore.getState().load();
      }
    };

    try {
      await streamChat(
        sessionId,
        trimmed,
        { onEvent: update, signal: controller.signal },
        locale,
        chat.modelId ?? undefined,
        chat.context,
        chat.attachments,
      );
    } catch (err) {
      const aborted = controller.signal.aborted;
      set((s) => {
        if (!s.chats[sessionId]) return s;
        return {
          chats: withChat(s.chats, sessionId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantMessage.id
                ? {
                    ...m,
                    streaming: false,
                    // 用户中止不算错误，保留已生成部分。
                    errorKey: aborted
                      ? null
                      : ((err as ApiError).messageKey ?? 'error.internal'),
                  }
                : m,
            ),
            streaming: false,
          })),
        };
      });
    } finally {
      if (controllers.get(sessionId) === controller) {
        controllers.delete(sessionId);
        // 兜底：若流结束却未收到 done 事件，确保不在「生成中」状态卡住。
        set((s) => {
          const cur = s.chats[sessionId];
          if (!cur || !cur.streaming) return s;
          return {
            chats: withChat(s.chats, sessionId, (c) => ({
              ...c,
              streaming: false,
              messages: c.messages.map((m) =>
                m.id === assistantMessage.id ? { ...m, streaming: false } : m,
              ),
            })),
          };
        });
      }
      void get().loadSessions();
    }
  },

  abortSession: (sessionId) => {
    controllers.get(sessionId)?.abort();
  },

  abortAll: () => {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
  },

  hasStreaming: () => Object.values(get().chats).some((c) => c.streaming),

  setModel: (sessionId, modelId) => {
    set((s) => ({
      chats: withChat(s.chats, sessionId, (chat) => ({ ...chat, modelId })),
    }));
    persistSessionContext(sessionId);
  },

  setContext: (sessionId, patch) => {
    set((s) => ({
      chats: withChat(s.chats, sessionId, (chat) => ({
        ...chat,
        context: { ...chat.context, ...patch },
      })),
    }));
    persistSessionContext(sessionId);
  },

  addAttachments: (sessionId, items) =>
    set((s) => ({
      chats: withChat(s.chats, sessionId, (chat) => {
        const known = new Set(chat.attachments.map((a) => a.path));
        const added = items.filter((a) => !known.has(a.path));
        return added.length
          ? { ...chat, attachments: [...chat.attachments, ...added] }
          : chat;
      }),
    })),

  removeAttachment: (sessionId, path) =>
    set((s) => ({
      chats: withChat(s.chats, sessionId, (chat) => ({
        ...chat,
        attachments: chat.attachments.filter((a) => a.path !== path),
      })),
    })),

  setDraft: (sessionId, text) =>
    set((s) => ({
      chats: withChat(s.chats, sessionId, (chat) => ({ ...chat, draft: text })),
    })),

  clearAllChats: () => {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    set({ chats: {} });
  },
}));
