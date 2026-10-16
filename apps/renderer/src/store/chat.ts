import { create } from 'zustand';
import type { SseEvent } from '@fireeyeaud/shared';
import {
  ApiError,
  createSessionApi,
  deleteSessionApi,
  deleteSessionMessageApi,
  EMPTY_CONTEXT,
  getSessionMessagesApi,
  listSessionsApi,
  renameSessionApi,
  streamChat,
  updateSessionContextApi,
  type AttachmentRef,
  type AttachmentText,
  type ChatContext,
  type ContextSnapshot,
  type SessionMessage,
  type SessionSummary,
  type WorkspaceRef,
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

/** 一次上下文压缩的提示信息（较早对话已摘要化）。 */
export interface CompactionInfo {
  summarizedUpTo: number;
  tokensBefore: number;
  tokensAfter: number;
  window: number;
}

/**
 * 输入框草稿：文本与内联 @ 标记（工作区引用 / 临时附件）的有序分段。
 * 由 MentionInput 编辑器序列化而来。
 */
export type DraftSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; ref: WorkspaceRef }
  | { type: 'attach'; ref: AttachmentRef };

/** 草稿中的纯文本（去空白）。 */
export function draftText(segments: DraftSegment[]): string {
  return segments
    .filter((s): s is { type: 'text'; text: string } => s.type === 'text')
    .map((s) => s.text)
    .join('')
    .trim();
}

/** 草稿中的工作区引用（按 path 去重，保序）。 */
export function draftMentions(segments: DraftSegment[]): WorkspaceRef[] {
  const seen = new Set<string>();
  const out: WorkspaceRef[] = [];
  for (const s of segments) {
    if (s.type !== 'mention' || seen.has(s.ref.path)) continue;
    seen.add(s.ref.path);
    out.push(s.ref);
  }
  return out;
}

/** 草稿中的临时附件（按 path 去重，保序）。 */
export function draftAttachments(segments: DraftSegment[]): AttachmentRef[] {
  const seen = new Set<string>();
  const out: AttachmentRef[] = [];
  for (const s of segments) {
    if (s.type !== 'attach' || seen.has(s.ref.path)) continue;
    seen.add(s.ref.path);
    out.push(s.ref);
  }
  return out;
}

/** 草稿是否有可发送内容（非空文本或任一标记）。 */
export function draftHasContent(segments: DraftSegment[]): boolean {
  return segments.some((s) => s.type !== 'text' || s.text.trim().length > 0);
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
  /** 该条用户消息随带的附件（助手消息为空）。 */
  attachments: AttachmentRef[];
  /** 该条用户消息 @ 引用的工作区条目（助手消息为空）。 */
  mentions: WorkspaceRef[];
  /** 附件的文本内容（本地抽取 / 模型转写），跨轮次可回放。 */
  attachmentTexts: AttachmentText[];
  /** 提示（如当前模型不支持图片/扫描版 PDF），仅用户消息可能非空。 */
  noticeKey: string | null;
  noticeParams: Record<string, unknown> | null;
  /** 上下文压缩提示（较早对话已摘要化），仅在发生压缩的那一轮/手动压缩时非空。 */
  compaction: CompactionInfo | null;
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
  /** 输入框草稿（文本 + 内联 @ 标记，随会话保留）。 */
  draft: DraftSegment[];
  /** 每次发送/清空后自增，用于强制重挂载编辑器以清空其 DOM。 */
  draftEpoch: number;
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
  send: (sessionId: string, locale: string) => Promise<void>;
  /** 中止单个会话的后台生成（保留已生成部分）。 */
  abortSession: (sessionId: string) => void;
  /** 中止所有会话的后台生成。 */
  abortAll: () => void;
  hasStreaming: () => boolean;
  setModel: (sessionId: string, modelId: string | null) => void;
  setContext: (sessionId: string, patch: Partial<ChatContext>) => void;
  setDraft: (sessionId: string, segments: DraftSegment[]) => void;
  /** 删除单条消息（后端按 id 持久化删除；非持久化消息仅本地移除）。 */
  deleteMessage: (sessionId: string, messageId: string) => Promise<void>;
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
    draft: [],
    draftEpoch: 0,
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
    attachments: [],
    mentions: [],
    attachmentTexts: [],
    noticeKey: null,
    noticeParams: null,
    compaction: null,
  };
}

/** 后端存储的消息投影 → 前端 ChatMessage。 */
function toChatMessage(message: SessionMessage): ChatMessage {
  const content =
    typeof message.content === 'string' || !message.content
      ? null
      : message.content;
  const text = typeof message.content === 'string' ? message.content : (content?.text ?? '');
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
    options: content?.options ?? null,
    attachments: content?.attachments ?? [],
    mentions: content?.mentions ?? [],
    attachmentTexts: content?.attachmentTexts ?? [],
    noticeKey: null,
    noticeParams: null,
    compaction: null,
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
    case 'notice':
      return {
        ...message,
        noticeKey: String(data.messageKey ?? ''),
        noticeParams: (data.params as Record<string, unknown>) ?? {},
      };
    case 'compaction':
      return {
        ...message,
        compaction: {
          summarizedUpTo: Number(data.summarizedUpTo ?? 0),
          tokensBefore: Number(data.tokensBefore ?? 0),
          tokensAfter: Number(data.tokensAfter ?? 0),
          window: Number(data.window ?? 0),
        },
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

  send: async (sessionId, locale) => {
    const current = get().chats[sessionId];
    if (current?.streaming) return;

    const segments = current?.draft ?? [];
    const text = draftText(segments);
    const mentions = draftMentions(segments);
    const attachments = draftAttachments(segments);
    if (!text && mentions.length === 0 && attachments.length === 0) return;

    // 若该会话还没有标题，用首条消息补上。
    const meta = get().sessions.find((s) => s.id === sessionId);
    if (meta && !meta.title) {
      const seed =
        text || mentions.map((m) => m.name).join('、') || attachments[0]?.name || '';
      const title = seed.slice(0, 40);
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
      content: text,
      thinking: '',
      phase: null,
      streaming: false,
      errorKey: null,
      tools: [],
      findingIds: [],
      options: null,
      attachments,
      mentions,
      attachmentTexts: [],
      noticeKey: null,
      noticeParams: null,
      compaction: null,
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
      attachments: [],
      mentions: [],
      attachmentTexts: [],
      noticeKey: null,
      noticeParams: null,
      compaction: null,
    };
    set((s) => ({
      chats: withChat(s.chats, sessionId, (chat) => ({
        ...chat,
        messages: [...chat.messages, userMessage, assistantMessage],
        streaming: true,
        // 清空草稿并强制重挂载编辑器，避免下次误发。
        draft: [],
        draftEpoch: chat.draftEpoch + 1,
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
      // 附件提示（如当前模型不支持图片/扫描版 PDF）也挂在用户消息上。
      if (event.type === 'notice') {
        set((s) => ({
          chats: withChat(s.chats, sessionId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === userMessage.id ? applyEvent(m, event) : m,
            ),
          })),
        }));
        return;
      }
      // 后端回传本轮两条消息的持久化 id：把本地临时 id 换成后端 id，供删除对齐。
      if (event.type === 'persisted') {
        const data = (event.data ?? {}) as {
          userMessageId?: string;
          assistantMessageId?: string | null;
        };
        set((s) => ({
          chats: withChat(s.chats, sessionId, (c) => ({
            ...c,
            messages: c.messages.map((m) => {
              if (data.userMessageId && m.id === userMessage.id) {
                return { ...m, id: data.userMessageId };
              }
              if (data.assistantMessageId && m.id === assistantMessage.id) {
                return { ...m, id: data.assistantMessageId };
              }
              return m;
            }),
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
        text,
        { onEvent: update, signal: controller.signal },
        locale,
        chat.modelId ?? undefined,
        chat.context,
        attachments,
        mentions,
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

  setDraft: (sessionId, segments) =>
    set((s) => ({
      chats: withChat(s.chats, sessionId, (chat) => ({ ...chat, draft: segments })),
    })),

  deleteMessage: async (sessionId, messageId) => {
    const chat = get().chats[sessionId];
    if (!chat || chat.streaming) return;
    try {
      await deleteSessionMessageApi(sessionId, messageId);
    } catch {
      /* 非持久化消息（报错/中止）后端无行：仅本地移除 */
    }
    set((s) => ({
      chats: withChat(s.chats, sessionId, (c) => ({
        ...c,
        messages: c.messages.filter((m) => m.id !== messageId),
      })),
    }));
  },

  clearAllChats: () => {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    set({ chats: {} });
  },
}));
