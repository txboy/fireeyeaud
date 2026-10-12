import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Paperclip, Send, Sparkles, Wrench } from 'lucide-react';
import { useChatStore } from '../store/chat';
import { ContextBar } from './ContextBar';

export function AgentColumn() {
  const { t, i18n } = useTranslation('agent');
  const { t: te } = useTranslation('error');
  const [text, setText] = useState('');

  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const send = useChatStore((s) => s.send);

  const submit = () => {
    if (!text.trim() || streaming) return;
    void send(text, i18n.language);
    setText('');
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
              <div className="msg__head">
                {m.role === 'assistant' && (
                  <Sparkles size={13} strokeWidth={1.75} color="var(--accent)" />
                )}
                <span className="msg__role">{t(m.role)}</span>
                {m.streaming && m.phase && (
                  <span className="msg__phase">{t(`phase.${m.phase}`)}</span>
                )}
              </div>
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

      <ContextBar />

      <div className="agent__input">
        <button type="button" className="activitybar__item" title={t('attach')}>
          <Paperclip size={16} strokeWidth={1.75} />
        </button>
        <button type="button" className="activitybar__item" title={t('selectTool')}>
          <Wrench size={16} strokeWidth={1.75} />
        </button>
        <input
          className="searchbox"
          value={text}
          onChange={(e) => setText(e.target.value)}
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
