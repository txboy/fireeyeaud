import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  BookOpen,
  Database,
  FileText,
  Paperclip,
  Plug,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import type { ContextSnapshot } from '../lib/api';
import { useChatStore } from '../store/chat';
import { ContextBar } from './ContextBar';

const OPT_GROUPS: {
  key: Exclude<keyof ContextSnapshot, 'model'>;
  labelKey: string;
  icon: LucideIcon;
}[] = [
  { key: 'database', labelKey: 'resDatabase', icon: Database },
  { key: 'knowledge', labelKey: 'resKnowledge', icon: BookOpen },
  { key: 'rules', labelKey: 'resRules', icon: ShieldCheck },
  { key: 'mcp', labelKey: 'resMcp', icon: Plug },
  { key: 'skills', labelKey: 'resSkills', icon: Sparkles },
];

/** 用户消息下方：本次发送时勾选的非默认选项（后端快照）。 */
function MessageOptions({ snapshot }: { snapshot: ContextSnapshot }) {
  const { t } = useTranslation('agent');
  const rows = OPT_GROUPS.flatMap((g) =>
    snapshot[g.key].map((item) => ({ group: g, item })),
  );
  if (rows.length === 0) return null;
  return (
    <div className="msg__options" title={t('sentOptions')}>
      {rows.map(({ group, item }) => (
        <span key={`${group.key}:${item.id}`} className="msg-opt">
          <group.icon size={11} strokeWidth={1.75} />
          <span className="msg-opt__group">{t(group.labelKey)}</span>
          <span className="msg-opt__name">{item.name}</span>
        </span>
      ))}
    </div>
  );
}

export function AgentColumn({ sessionId }: { sessionId: string }) {
  const { t, i18n } = useTranslation('agent');
  const { t: te } = useTranslation('error');

  const chat = useChatStore((s) => s.chats[sessionId]);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const send = useChatStore((s) => s.send);
  const setDraft = useChatStore((s) => s.setDraft);
  const addAttachments = useChatStore((s) => s.addAttachments);
  const removeAttachment = useChatStore((s) => s.removeAttachment);

  const messages = chat?.messages ?? [];
  const streaming = chat?.streaming ?? false;
  const attachments = chat?.attachments ?? [];
  const text = chat?.draft ?? '';

  useEffect(() => {
    void loadMessages(sessionId);
  }, [sessionId, loadMessages]);

  const pickFiles = async () => {
    const files = (await window.fireeyeaud?.openFiles('attachments')) ?? [];
    if (files.length === 0) return;
    addAttachments(
      sessionId,
      files.map((path) => ({
        path,
        name: path.split(/[\\/]/).pop() || path,
      })),
    );
  };

  const submit = () => {
    if (!text.trim() || streaming) return;
    void send(sessionId, text, i18n.language);
  };

  const errorText = (key: string) => te(key.replace(/^error\./, ''));

  return (
    <main className="agent">
      <div className="agent__head">
        <Sparkles size={16} strokeWidth={1.75} color="var(--accent)" />
        <span className="sidebar__title">{t('name')}</span>
      </div>

      <div className="agent__conv">
        {messages.length === 0 ? (
          <div className="panel-empty">
            <Sparkles size={26} strokeWidth={1.5} />
            <span>{t('empty')}</span>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`msg msg--${m.role}`}>
              {m.role === 'assistant' && (
                <div className="msg__head">
                  <Sparkles size={13} strokeWidth={1.75} color="var(--accent)" />
                  <span className="msg__role">{t(m.role)}</span>
                  {m.streaming && m.phase && (
                    <span className="msg__phase">{t(`phase.${m.phase}`)}</span>
                  )}
                </div>
              )}
              {m.thinking && <div className="msg__thinking">{m.thinking}</div>}
              {m.tools.length > 0 && (
                <div className="msg__tools">
                  {m.tools.map((tool) => (
                    <div key={tool.callId} className="tool-card">
                      <Wrench size={12} strokeWidth={1.75} />
                      <span className="tool-card__name">{tool.tool}</span>
                      <span className="tool-card__sep">·</span>
                      <span className="tool-card__summary">
                        {tool.ok === undefined
                          ? t('toolCall')
                          : tool.ok
                            ? tool.summary
                            : te('internal')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {m.findingIds.length > 0 && (
                <div className="msg__findings">
                  {m.findingIds.map((id) => (
                    <span key={id} className="finding-badge">
                      {t('findingCreated', { id })}
                    </span>
                  ))}
                </div>
              )}
              <div className="msg__body">
                {m.content}
                {m.streaming && <span className="msg__caret" />}
              </div>
              {m.role === 'user' && m.options && (
                <MessageOptions snapshot={m.options} />
              )}
              {m.errorKey && (
                <div className="msg__error">
                  <AlertTriangle size={13} strokeWidth={1.75} />
                  <span>{errorText(m.errorKey)}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <ContextBar sessionId={sessionId} />

      {attachments.length > 0 && (
        <div className="agent__attachments">
          {attachments.map((a) => (
            <span key={a.path} className="attach-chip" title={a.path}>
              <FileText size={12} strokeWidth={1.75} />
              <span className="attach-chip__name">{a.name}</span>
              <button
                type="button"
                className="attach-chip__remove"
                title={t('removeAttachment')}
                onClick={() => removeAttachment(sessionId, a.path)}
              >
                <X size={11} strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="agent__input">
        <button
          type="button"
          className="activitybar__item"
          title={t('attach')}
          onClick={() => void pickFiles()}
        >
          <Paperclip size={16} strokeWidth={1.75} />
        </button>
        <input
          className="searchbox"
          value={text}
          onChange={(e) => setDraft(sessionId, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          }}
          placeholder={t('inputPlaceholder')}
        />
        <button
          type="button"
          className="button"
          title={t('send')}
          onClick={submit}
          disabled={!text.trim() || streaming}
        >
          <Send size={15} strokeWidth={1.9} />
        </button>
      </div>
    </main>
  );
}
