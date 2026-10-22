import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Send } from 'lucide-react';
import {
  listReportMessages,
  streamReportChat,
  type ReportStreamEvent,
} from '../../lib/api';

interface ChatItem {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
}

const TOOL_LABEL: Record<string, string> = {
  report_set_outline: 'toolOutline',
  report_write_section: 'toolSection',
  report_set_title: 'toolTitle',
  report_verify: 'toolCheck',
};

/** 报告写作对话：流式增量 + 工具状态；写入后通知父级刷新文档。 */
export function ReportChat({
  reportId,
  onChanged,
}: {
  reportId: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation('report');
  const { t: terr } = useTranslation('error');
  const { i18n } = useTranslation();

  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setItems([]);
    setError(null);
    setTool(null);
    void listReportMessages(reportId)
      .then((page) => {
        setItems(
          page.items
            .filter((entry) => entry.content?.trim())
            .map((entry) => ({ role: entry.role, content: entry.content })),
        );
      })
      .catch(() => undefined);
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [reportId]);

  useEffect(() => {
    const node = bodyRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [items, tool]);

  const apply = (event: ReportStreamEvent) => {
    if (event.event === 'delta') {
      const text = String(event.data.text ?? '');
      if (!text) return;
      setItems((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant' && !last.error) {
          next[next.length - 1] = { ...last, content: last.content + text };
        } else {
          next.push({ role: 'assistant', content: text });
        }
        return next;
      });
    } else if (event.event === 'tool') {
      const name = String(event.data.name ?? '');
      setTool(TOOL_LABEL[name] ? t(TOOL_LABEL[name]) : null);
    } else if (event.event === 'report') {
      setTool(null);
      onChanged();
    } else if (event.event === 'error') {
      const key = String(event.data.messageKey ?? 'error.internal');
      setError(terr(key.replace(/^error\./, '')));
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft('');
    setError(null);
    setItems((prev) => [...prev, { role: 'user', content: text }]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamReportChat(
        reportId,
        { message: text, locale: i18n.language || 'zh-CN' },
        apply,
        controller.signal,
      );
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        const key = (err as { messageKey?: string }).messageKey ?? 'error.internal';
        setError(terr(key.replace(/^error\./, '')));
      }
    } finally {
      setStreaming(false);
      setTool(null);
      abortRef.current = null;
      onChanged();
    }
  };

  return (
    <section className="report-chat">
      <div className="report-chat__head">
        <div>
          <div className="report-chat__title">{t('chatTitle')}</div>
          <div className="card__meta">{t('chatHint')}</div>
        </div>
      </div>

      <div className="report-chat__body" ref={bodyRef}>
        {items.length === 0 && !streaming ? (
          <div className="report-chat__empty">{t('chatEmpty')}</div>
        ) : (
          items.map((item, index) => (
            <div
              key={`${item.role}-${index}`}
              className={`report-msg report-msg--${item.role}${item.error ? ' report-msg--error' : ''}`}
            >
              <div className="report-msg__role">
                {item.role === 'user' ? t('userRole') : t('chatTitle')}
              </div>
              <div className="report-msg__text">{item.content}</div>
            </div>
          ))
        )}
        {streaming && !items.some((item) => item.role === 'assistant') && (
          <div className="report-chat__tool">
            <Loader2 size={12} className="spin" /> {t('thinking')}
          </div>
        )}
        {tool && (
          <div className="report-chat__tool">
            <Loader2 size={12} className="spin" /> {tool}
          </div>
        )}
        {error && <div className="panel-error">{error}</div>}
      </div>

      <div className="report-chat__composer">
        <textarea
          className="searchbox report-chat__input"
          rows={3}
          value={draft}
          placeholder={t('chatPlaceholder')}
          disabled={streaming}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="button report-chat__send"
          disabled={streaming || !draft.trim()}
          onClick={() => void send()}
        >
          {streaming ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
          {t('send')}
        </button>
      </div>
    </section>
  );
}
