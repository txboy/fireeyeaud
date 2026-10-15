import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  BookOpen,
  Database,
  FileText,
  Folder,
  Paperclip,
  Plug,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { ContextSnapshot, WorkspaceRef } from '../lib/api';
import { draftHasContent, useChatStore } from '../store/chat';
import { ContextBar } from './ContextBar';
import { MentionInput, type MentionInputHandle } from './MentionInput';

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

/** 用户消息下方：@ 引用的工作区条目。 */
function MessageMentions({ mentions }: { mentions: WorkspaceRef[] }) {
  if (mentions.length === 0) return null;
  return (
    <div className="msg__files">
      {mentions.map((m) => (
        <span key={m.path} className="msg-file" title={m.path}>
          {m.isDir ? (
            <Folder size={11} strokeWidth={1.75} />
          ) : (
            <FileText size={11} strokeWidth={1.75} />
          )}
          <span className="msg-file__name">@{m.name}</span>
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

  const editorRef = useRef<MentionInputHandle>(null);

  const messages = chat?.messages ?? [];
  const streaming = chat?.streaming ?? false;
  const draft = chat?.draft ?? [];
  const canSend = draftHasContent(draft) && !streaming;

  useEffect(() => {
    void loadMessages(sessionId);
  }, [sessionId, loadMessages]);

  const pickFiles = async () => {
    const files = (await window.fireeyeaud?.openFiles('attachments')) ?? [];
    for (const path of files) {
      editorRef.current?.insertAttachment({
        path,
        name: path.split(/[\\/]/).pop() || path,
      });
    }
  };

  const submit = () => {
    if (!canSend) return;
    void send(sessionId, i18n.language);
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
              {m.role === 'user' && m.mentions.length > 0 && (
                <MessageMentions mentions={m.mentions} />
              )}
              {m.role === 'user' && m.attachments.length > 0 && (
                <div className="msg__files">
                  {m.attachments.map((a) => (
                    <span key={a.path} className="msg-file" title={a.path}>
                      <FileText size={11} strokeWidth={1.75} />
                      <span className="msg-file__name">{a.name}</span>
                    </span>
                  ))}
                </div>
              )}
              {m.role === 'user' && m.attachmentTexts.length > 0 && (
                <details className="msg__attach-text">
                  <summary>{t('attachmentText')}</summary>
                  {m.attachmentTexts.map((at) => (
                    <div key={at.name} className="msg__attach-text-item">
                      <div className="msg__attach-text-name">{at.name}</div>
                      <pre className="msg__attach-text-body">{at.text}</pre>
                    </div>
                  ))}
                </details>
              )}
              {m.role === 'user' && m.noticeKey && (
                <div className="msg__notice">
                  <AlertTriangle size={13} strokeWidth={1.75} />
                  <span>
                    {t(m.noticeKey, {
                      files: String(m.noticeParams?.files ?? ''),
                    })}
                  </span>
                </div>
              )}
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

      <div className="agent__input">
        <button
          type="button"
          className="activitybar__item"
          title={t('attach')}
          onClick={() => void pickFiles()}
        >
          <Paperclip size={16} strokeWidth={1.75} />
        </button>
        <MentionInput
          key={`${sessionId}:${chat?.draftEpoch ?? 0}`}
          ref={editorRef}
          initialSegments={draft}
          placeholder={t('inputPlaceholder')}
          disabled={streaming}
          onChange={(segments) => setDraft(sessionId, segments)}
          onSubmit={submit}
        />
        <button
          type="button"
          className="button"
          title={t('send')}
          onClick={submit}
          disabled={!canSend}
        >
          <Send size={15} strokeWidth={1.9} />
        </button>
      </div>
    </main>
  );
}
