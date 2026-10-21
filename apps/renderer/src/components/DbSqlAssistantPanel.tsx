import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerDownLeft, Send, Sparkles, Square, Table2, Trash2, X } from 'lucide-react';
import type { DbQueryResult, DbTableSchema } from '@fireeyeaud/shared';
import { streamDbSqlChat } from '../lib/api';
import { buildDbSqlContext } from '../lib/dbSqlContext';
import { buildSqlChatHistory } from '../lib/dbSqlHistory';
import {
  abortThread,
  getThread,
  releaseThread,
  useDbSqlAssistantStore,
  type DbSqlStep,
} from '../store/dbSqlAssistant';
import { useConfirmStore } from '../store/confirm';
import type { DbDataTab } from '../store/ui';
import { Markdown } from './Markdown';

/** 用户停在底部附近时才自动跟随流式输出。 */
const STICK_THRESHOLD = 48;

export interface DbSqlAssistantPanelProps {
  tab: DbDataTab;
  /** 当前编辑器中的 SQL。 */
  sql: string;
  /** 全部已反射的表结构（供模型理解关联关系）。 */
  tables: DbTableSchema[];
  result: DbQueryResult | null;
  /** 已本地化的错误文本（不传 messageKey，避免模型看到 i18n key）。 */
  error: string | null;
  page: number;
  pageSize: number;
  total: number | null;
  onInsert: (sql: string) => void;
  onRun: (sql: string) => void;
  onClose: () => void;
}

/**
 * SQL 助手面板：自然语言 → 只读 SQL。
 *
 * 不直接执行 SQL：生成结果通过 `onInsert` / `onRun` 交给 `DbDataView`，
 * 「直接运行」仍走现有只读校验通道。
 */
export function DbSqlAssistantPanel(props: DbSqlAssistantPanelProps) {
  const { tab, tables, result, error, page, pageSize, total, onInsert, onRun, onClose } =
    props;
  const { t } = useTranslation('database');
  const { t: terr } = useTranslation('error');
  const { i18n } = useTranslation();
  const confirm = useConfirmStore((s) => s.confirm);

  const threads = useDbSqlAssistantStore((s) => s.threads);
  const store = useDbSqlAssistantStore;
  const thread = threads[tab.id] ?? getThread(tab.id);

  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  /** 本面板发出的请求；发新请求或停止时复用。 */
  const controllerRef = useRef<AbortController | null>(null);

  const examples = useMemo(
    () => [t('assistantExample1'), t('assistantExample2'), t('assistantExample3')],
    [t],
  );

  // 用户向上翻阅时不强制滚动，停在底部附近才跟随。
  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [thread.messages, thread.busy]);

  // 生成中关闭面板（或切走该 tab）即中断请求：保留已生成内容并标记「已停止生成」。
  // 仍在运行的请求不会被 abort（清空 / 已完成），不会误伤。
  useEffect(() => {
    const tabId = tab.id;
    return () => {
      useDbSqlAssistantStore.getState().abortThread(tabId);
    };
  }, [tab.id]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD;
  };

  const send = async (text: string) => {
    const content = text.trim();
    // 用 getState() 判断，而不是渲染闭包：同一 tick 里连按两次 Enter 时闭包的
    // busy 仍是 false，会发出两个请求并让后一个 abort 掉前一个。
    if (!content || getThread(tab.id).busy) return;

    const history = getThread(tab.id).messages
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }));

    setInput('');
    stickRef.current = true;
    store.getState().appendUser(tab.id, content);
    const assistant = store.getState().startAssistant(tab.id);

    const controller = new AbortController();
    controllerRef.current = controller;
    abortThread(tab.id, controller);

    try {
      await streamDbSqlChat(
        {
          scope: tab.scope,
          connectionId: tab.connectionId,
          table: tab.table.table,
          driver: tab.driver,
          messages: buildSqlChatHistory(history, content),
          context: buildDbSqlContext({
            tab,
            tables,
            currentSql: props.sql,
            executedSql: result?.sql ?? null,
            result,
            error,
            page,
            pageSize,
            total,
          }),
          locale: i18n.language,
          modelId: null,
        },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'token') {
              store.getState().appendDelta(tab.id, assistant.id, event.data.delta ?? '');
            } else if (event.type === 'tool_call') {
              store.getState().appendToolCall(tab.id, assistant.id, {
                callId: event.data.callId ?? '',
                tool: event.data.tool ?? '',
                table: String(event.data.params?.table ?? ''),
              });
            } else if (event.type === 'tool_result') {
              store.getState().finishToolCall(tab.id, assistant.id, {
                callId: event.data.callId ?? '',
                ok: Boolean(event.data.ok),
                summary: event.data.summary ?? '',
                ...(event.data.messageKey ? { messageKey: event.data.messageKey } : {}),
                ...(event.data.reason
                  ? { reason: event.data.reason as 'notAllowed' | 'tooMany' }
                  : {}),
                ...(typeof event.data.rows === 'number' ? { rows: event.data.rows } : {}),
                ...(typeof event.data.columnsCount === 'number'
                  ? { columnsCount: event.data.columnsCount }
                  : {}),
              });
            } else if (event.type === 'error') {
              store
                .getState()
                .fail(tab.id, assistant.id, event.data.messageKey ?? 'error.internal');
            }
          },
        },
      );
      store.getState().finish(tab.id, assistant.id);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        store.getState().finish(tab.id, assistant.id, true);
      } else {
        store
          .getState()
          .fail(
            tab.id,
            assistant.id,
            (err as { messageKey?: string }).messageKey ?? 'error.internal',
          );
      }
    } finally {
      releaseThread(tab.id, controller);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const stop = () => {
    // 中断后由 send 的 catch 分支标记「已停止生成」，保留已生成内容。
    controllerRef.current?.abort();
  };

  const clear = async () => {
    const ok = await confirm({
      title: t('assistantClear'),
      message: t('assistantClearConfirm'),
      confirmLabel: t('assistantClear'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (ok) store.getState().clearThread(tab.id);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  };

  const stepLabel = (step: DbSqlStep): string => {
    if (step.pending) return t('assistantToolPending', { table: step.table });
    if (step.ok) {
      return t('assistantToolOk', {
        table: step.table,
        rows: step.rows ?? 0,
        columns: step.columnsCount ?? 0,
      });
    }
    if (step.reason === 'notAllowed') return t('assistantToolNotAllowed', { table: step.table });
    if (step.reason === 'tooMany') return t('assistantToolTooMany', { table: step.table });
    if (step.messageKey) {
      return `${step.table}：${terr(step.messageKey.replace(/^error\./, ''))}`;
    }
    return t('assistantToolFailed', { table: step.table });
  };

  const sqlActions = useMemo(
    () => ({
      insertLabel: t('insertToEditor'),
      runLabel: t('runSql'),
      onInsert,
      onRun,
    }),
    [t, onInsert, onRun],
  );

  return (
    <aside className="dbdata__assistant" aria-label={t('assistantTitle')}>
      <div className="dbdata__assistant-head">
        <Sparkles size={13} strokeWidth={1.8} className="dbdata__assistant-icon" />
        <span className="dbdata__assistant-title">{t('assistantTitle')}</span>
        <span className="dbdata__assistant-table" title={tab.table.table}>
          {tab.table.table}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="icon-btn"
          title={t('assistantClear')}
          aria-label={t('assistantClear')}
          disabled={thread.messages.length === 0 && !thread.errorKey}
          onClick={() => void clear()}
        >
          <Trash2 size={13} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t('assistantTitle')}
          aria-label={t('assistantTitle')}
          onClick={onClose}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div className="dbdata__assistant-list" ref={listRef} onScroll={onScroll}>
        {thread.messages.length === 0 && (
          <div className="dbdata__assistant-empty">
            <p>{t('assistantEmpty')}</p>
            <div className="dbdata__assistant-examples">
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  className="dbdata__assistant-example"
                  onClick={() => setInput(example)}
                >
                  <CornerDownLeft size={11} strokeWidth={1.8} />
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {thread.messages.map((message) => (
          <div
            key={message.id}
            className={`dbdata__assistant-msg dbdata__assistant-msg--${message.role}`}
          >
            {message.role === 'user' ? (
              <div className="dbdata__assistant-user">{message.content}</div>
            ) : (
              <div className="dbdata__assistant-reply">
                {(message.steps?.length ?? 0) > 0 && (
                  <div className="dbdata__assistant-steps">
                    {message.steps?.map((step) => (
                      <div
                        key={step.callId}
                        className={`dbdata__assistant-step${
                          step.pending
                            ? ' dbdata__assistant-step--pending'
                            : step.ok
                              ? ''
                              : ' dbdata__assistant-step--failed'
                        }`}
                        title={step.summary || undefined}
                      >
                        <Table2 size={11} strokeWidth={1.8} />
                        <span className="dbdata__assistant-step-text">
                          {stepLabel(step)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {message.content ? (
                  <Markdown
                    content={message.content}
                    plain={thread.busy && message.id === thread.messages.at(-1)?.id}
                    sqlActions={sqlActions}
                  />
                ) : (
                  thread.busy && <span className="dbdata__assistant-dots" aria-hidden="true" />
                )}
                {message.interrupted && (
                  <div className="dbdata__assistant-note">{t('assistantInterrupted')}</div>
                )}
              </div>
            )}
          </div>
        ))}

        {thread.errorKey && (
          <div className="dbdata__assistant-error">
            {terr(thread.errorKey.replace(/^error\./, ''))}
            {thread.errorKey === 'error.llmUnavailable' && (
              <div className="dbdata__assistant-note">{t('assistantLlmMissing')}</div>
            )}
          </div>
        )}
      </div>

      <div className="dbdata__assistant-input">
        <div className="dbdata__assistant-notice">
          <Table2 size={10} strokeWidth={1.8} />
          {t('assistantSampleHint')}
        </div>
        <textarea
          className="dbdata__assistant-textarea"
          value={input}
          rows={3}
          placeholder={t('assistantPlaceholder')}
          aria-label={t('assistantPlaceholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="dbdata__assistant-actions">
          <span className="dbdata__assistant-hint">{t('assistantReadonlyHint')}</span>
          {thread.busy ? (
            <button type="button" className="button button--sm button--ghost" onClick={stop}>
              <Square size={11} strokeWidth={2} /> {t('assistantStop')}
            </button>
          ) : (
            <button
              type="button"
              className="button button--sm"
              disabled={!input.trim()}
              onClick={() => void send(input)}
            >
              <Send size={12} strokeWidth={1.9} /> {t('assistantSend')}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}