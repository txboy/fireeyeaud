import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowDown,
  BookOpen,
  Database,
  FileText,
  Folder,
  History,
  Paperclip,
  Plug,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { ContextSnapshot, WorkspaceRef } from '../lib/api';
import { draftHasContent, useChatStore, type CompactionInfo } from '../store/chat';
import { ContextBar } from './ContextBar';
import { MentionInput, type MentionInputHandle } from './MentionInput';
import { Markdown } from './Markdown';
import { MessageActions } from './MessageActions';

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

const formatTokens = (n: number): string =>
  n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

/** 对话流中的分隔提示：较早对话已压缩为摘要。 */
function CompactionDivider({ info }: { info: CompactionInfo }) {
  const { t } = useTranslation('agent');
  return (
    <div className="compaction-divider" title={t('compactionDividerTitle')}>
      <History size={12} strokeWidth={1.75} />
      <span>
        {t('compactionDivider', {
          count: info.summarizedUpTo,
          before: formatTokens(info.tokensBefore),
          after: formatTokens(info.tokensAfter),
        })}
      </span>
    </div>
  );
}

/** 距底多近算「贴底」（像素）：小于该值即视为停留在最新输出处。 */
const SCROLL_BOTTOM_THRESHOLD = 40;

export function AgentColumn({ sessionId }: { sessionId: string }) {
  const { t, i18n } = useTranslation('agent');
  const { t: te } = useTranslation('error');

  const chat = useChatStore((s) => s.chats[sessionId]);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const send = useChatStore((s) => s.send);
  const setDraft = useChatStore((s) => s.setDraft);

  const editorRef = useRef<MentionInputHandle>(null);
  const convRef = useRef<HTMLDivElement>(null);
  // 是否贴底（用户未主动上翻）。放 ref 供 effect 同步读取，另用 state 驱动按钮显隐。
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const messages = chat?.messages ?? [];
  const streaming = chat?.streaming ?? false;
  const draft = chat?.draft ?? [];
  const canSend = draftHasContent(draft) && !streaming;

  const scrollToBottom = () => {
    const el = convRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const handleScroll = () => {
    const el = convRef.current;
    if (!el) return;
    const next =
      el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
    stickRef.current = next;
    setAtBottom((prev) => (prev === next ? prev : next));
  };

  useEffect(() => {
    void loadMessages(sessionId);
  }, [sessionId, loadMessages]);

  // 切换会话：重置为贴底（组件被复用、不重挂载）；消息异步加载后再由下方 effect 贴底。
  useEffect(() => {
    stickRef.current = true;
    setAtBottom(true);
    scrollToBottom();
  }, [sessionId]);

  // 消息/流式 token 更新后，若用户仍在底部则即时跟随（useLayoutEffect 避免闪烁）。
  useLayoutEffect(() => {
    if (stickRef.current) scrollToBottom();
  }, [messages]);

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
    // 发送后立刻贴底，让用户自己的消息与随后的回复可见。
    stickRef.current = true;
    setAtBottom(true);
    void send(sessionId, i18n.language);
  };

  const errorText = (key: string) => te(key.replace(/^error\./, ''));

  return (
    <main className="agent">
      <div className="agent__head">
        <Sparkles size={16} strokeWidth={1.75} color="var(--accent)" />
        <span className="sidebar__title">{t('name')}</span>
      </div>

      <div className="agent__conv-wrap">
        <div className="agent__conv" ref={convRef} onScroll={handleScroll}>
          {messages.length === 0 ? (
            <div className="panel-empty">
              <Sparkles size={26} strokeWidth={1.5} />
              <span>{t('empty')}</span>
            </div>
          ) : (
            messages.map((m) => {
              const compactionOnly =
                m.compaction !== null &&
                !m.content &&
                !m.thinking &&
                !m.errorKey &&
                m.tools.length === 0;
              return (
              <div key={m.id} className={`msg msg--${m.role}`}>
                {m.compaction && <CompactionDivider info={m.compaction} />}
                {!compactionOnly && m.role === 'assistant' && (
                  <div className="msg__head">
                    <Sparkles size={13} strokeWidth={1.75} color="var(--accent)" />
                    <span className="msg__role">{t(m.role)}</span>
                    {m.streaming && m.phase && (
                      <span className="msg__phase">{t(`phase.${m.phase}`)}</span>
                    )}
                  </div>
                )}
                {!compactionOnly && m.thinking && (
                  <div className="msg__thinking">{m.thinking}</div>
                )}
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
                {!compactionOnly && (
                  <div
                    className={`msg__body${m.role === 'assistant' ? ' msg__body--md' : ''}`}
                  >
                    {m.role === 'assistant' && m.content ? (
                      <Markdown content={m.content} plain={m.streaming} />
                    ) : (
                      m.content
                    )}
                    {m.streaming && <span className="msg__caret" />}
                  </div>
                )}
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
                {!compactionOnly && (
                  <MessageActions
                    message={m}
                    sessionId={sessionId}
                    disabled={streaming}
                  />
                )}
              </div>
              );
            })
          )}
        </div>
        {messages.length > 0 && !atBottom && (
          <button
            type="button"
            className="agent__scroll-latest"
            title={t('scrollToLatest')}
            aria-label={t('scrollToLatest')}
            onClick={scrollToBottom}
          >
            <ArrowDown size={16} strokeWidth={1.9} />
          </button>
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
