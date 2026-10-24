import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Loader2, Send } from 'lucide-react';
import type { EvidenceFormManifest } from '@fireeyeaud/shared';
import {
  listFormMessages,
  listReportMessages,
  setFormFindings,
  setReportForms,
  streamFormChat,
  streamReportChat,
  type ReportStreamEvent,
} from '../../lib/api';
import { useFormsStore } from '../../store/forms';
import { useFindingsStore } from '../../store/findings';
import type { WorkspaceKind } from '../../store/workspaceKind';
import { ModelSelect } from '../ModelSelect';

interface ChatItem {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
}

/** 工具名 → 文案 key；报告与取证单的工具名不同但语义一致。 */
const TOOL_LABEL: Record<string, string> = {
  report_set_outline: 'toolOutline',
  report_write_section: 'toolSection',
  report_set_title: 'toolTitle',
  report_verify: 'toolCheck',
  form_set_outline: 'toolOutline',
  form_write_section: 'toolSection',
  form_set_title: 'toolTitle',
  form_verify: 'toolCheck',
};

interface SourceOption {
  id: string;
  title: string;
  meta: string;
}

/**
 * 写作对话：流式增量 + 工具状态；写入后通知父级刷新文档。
 * - 报告：本轮来源是「取证单」；
 * - 取证单：本轮来源是「疑点」。
 */
export function WorkspaceChat({
  kind,
  id,
  selectedIds,
  onChanged,
}: {
  kind: WorkspaceKind;
  id: string;
  selectedIds: string[];
  onChanged: () => void;
}) {
  const { t } = useTranslation(kind === 'report' ? 'report' : 'evidence-form');
  const { t: terr } = useTranslation('error');
  const { i18n } = useTranslation();

  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(selectedIds);

  const formItems = useFormsStore((s) => s.items);
  const loadForms = useFormsStore((s) => s.load);
  const findingItems = useFindingsStore((s) => s.items);
  const loadFindings = useFindingsStore((s) => s.load);

  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const sources: SourceOption[] =
    kind === 'report'
      ? formItems.map((form: EvidenceFormManifest) => ({
          id: form.id,
          title: `${form.id} · ${form.title}`,
          meta: t('formFindings', { count: form.findingIds.length }),
        }))
      : findingItems.map((finding) => ({
          id: finding.id,
          title: `${finding.id} · ${finding.title?.text || finding.ruleKey || ''}`,
          meta: finding.severity,
        }));

  useEffect(() => {
    setSelected(selectedIds);
  }, [id, selectedIds]);

  useEffect(() => {
    if (kind === 'report') {
      void loadForms();
    } else {
      void loadFindings();
    }
  }, [kind, loadForms, loadFindings]);

  useEffect(() => {
    setItems([]);
    setError(null);
    setTool(null);
    const request =
      kind === 'report' ? listReportMessages(id) : listFormMessages(id);
    void request
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
  }, [id, kind]);

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

  const toggleSource = (sourceId: string) =>
    setSelected((prev) =>
      prev.includes(sourceId)
        ? prev.filter((item) => item !== sourceId)
        : [...prev, sourceId],
    );

  const send = async () => {
    const text = draft.trim();
    if (!text || streaming) return;
    const changed =
      selected.length !== selectedIds.length ||
      selected.some((sourceId, index) => sourceId !== selectedIds[index]);
    setError(null);
    if (changed) {
      try {
        if (kind === 'report') await setReportForms(id, selected);
        else await setFormFindings(id, selected);
      } catch (err) {
        const key = (err as { messageKey?: string }).messageKey ?? 'error.internal';
        setError(terr(key.replace(/^error\./, '')));
        return;
      }
    }
    setDraft('');
    setItems((prev) => [...prev, { role: 'user', content: text }]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const input = {
        message: text,
        locale: i18n.language || 'zh-CN',
        ...(modelId ? { modelId } : {}),
      };
      if (kind === 'report') {
        await streamReportChat(id, input, apply, controller.signal);
      } else {
        await streamFormChat(id, input, apply, controller.signal);
      }
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

  const sourceButtonKey = kind === 'report' ? 'formsSelected' : 'findingsSelected';
  const sourceHintKey = kind === 'report' ? 'formsForTurn' : 'findingsForTurn';
  const sourceEmptyKey = kind === 'report' ? 'noForms' : 'noFindings';

  return (
    <section className="report-chat">
      <div className="report-chat__head">
        <div className="report-chat__head-main">
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
        <div className="report-chat__composer-tools">
          <ModelSelect value={modelId} disabled={streaming} onChange={setModelId} />
          <details className="report-forms">
            <summary
              className="ctx-btn"
              title={t(sourceHintKey)}
              aria-label={t(sourceHintKey)}
            >
              <FileText size={11} strokeWidth={1.8} />
              {t(sourceButtonKey, { count: selected.length })}
            </summary>
            <div className="report-forms__menu">
              <div className="card__meta report-forms__hint">{t(sourceHintKey)}</div>
              {sources.length === 0 ? (
                <div className="card__meta">{t(sourceEmptyKey)}</div>
              ) : (
                <div className="artifact-select report-form-picker">
                  {sources.map((source) => (
                    <label key={source.id} className="artifact-select__item">
                      <input
                        type="checkbox"
                        checked={selected.includes(source.id)}
                        disabled={streaming}
                        onChange={() => toggleSource(source.id)}
                      />
                      <span className="artifact-select__label" title={source.title}>
                        {source.title}
                      </span>
                      <span className="card__meta">{source.meta}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </details>
        </div>
        <div className="report-chat__composer-row">
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
      </div>
    </section>
  );
}