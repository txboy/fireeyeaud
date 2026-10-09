import { create } from 'zustand';
import type { SseEvent } from '@fireeyeaud/shared';
import { ApiError, createSessionApi, streamChat } from '../lib/api';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  thinking: string;
  phase: string | null;
  streaming: boolean;
  errorKey: string | null;
}

interface ChatState {
  sessionId: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  send: (text: string, locale: string) => Promise<void>;
  clear: () => void;
}

let counter = 0;
const nextId = () => `m_${Date.now().toString(36)}_${(counter += 1)}`;

function applyEvent(message: ChatMessage, event: SseEvent): ChatMessage {
  const data = (event.data ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case 'status':
      return { ...message, phase: (data.phase as string) ?? message.phase };
    case 'thinking':
      return { ...message, thinking: String(data.text ?? '') };
    case 'token':
      return { ...message, content: message.content + String(data.delta ?? '') };
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
  messages: [],
  streaming: false,

  send: async (text, locale) => {
    const trimmed = text.trim();
    if (!trimmed || get().streaming) return;

    let sessionId = get().sessionId;
    try {
      if (!sessionId) {
        const session = await createSessionApi({ title: trimmed.slice(0, 40) });
        sessionId = session.id;
        set({ sessionId });
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
    };
    const assistantMessage: ChatMessage = {
      id: nextId(),
      role: 'assistant',
      content: '',
      thinking: '',
      phase: null,
      streaming: true,
      errorKey: null,
    };
    set((s) => ({
      messages: [...s.messages, userMessage, assistantMessage],
      streaming: true,
    }));

    const update = (event: SseEvent) =>
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessage.id ? applyEvent(m, event) : m,
        ),
        streaming:
          event.type === 'done' || event.type === 'error' ? false : s.streaming,
      }));

    try {
      await streamChat(sessionId, trimmed, { onEvent: update }, locale);
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
    }
  },

  clear: () => set({ sessionId: null, messages: [], streaming: false }),
}));
