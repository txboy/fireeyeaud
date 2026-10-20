import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { basicSetup, EditorView } from 'codemirror';
import { Compartment, type Extension } from '@codemirror/state';
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { hoverTooltip, keymap } from '@codemirror/view';
import {
  MSSQL,
  MySQL,
  PLSQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  sql,
  type SQLDialect,
  type SQLNamespace,
} from '@codemirror/lang-sql';
import type { DbDriver, DbTableSchema } from '@fireeyeaud/shared';
import { validateDbSql, type DbSqlDiagnostic } from '../lib/api';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  tables: DbTableSchema[];
  driver: DbDriver;
  defaultTable: string;
  dark: boolean;
  ariaLabel: string;
}

function dialectFor(driver: DbDriver): SQLDialect {
  switch (driver) {
    case 'sqlite':
      return SQLite;
    case 'postgresql':
      return PostgreSQL;
    case 'mysql':
      return MySQL;
    case 'mssql':
    case 'access':
      return MSSQL;
    case 'oracle':
      return PLSQL;
    default:
      return StandardSQL;
  }
}

function buildSchema(tables: DbTableSchema[]): Record<string, SQLNamespace> {
  const schema: Record<string, SQLNamespace> = {};
  for (const table of tables) {
    schema[table.table] = {
      self: {
        label: table.table,
        type: 'type',
        detail: table.comment ?? undefined,
      },
      children: table.columns.map((column) => ({
        label: column.name,
        type: 'property',
        detail: column.type,
        info: [column.type, column.comment].filter(Boolean).join(' · ') || undefined,
        boost: column.primaryKey ? 1 : 0,
      })),
    };
  }
  return schema;
}

function editorTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': {
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--text-1)',
        fontSize: '12.5px',
      },
      '.cm-scroller': {
        fontFamily: 'var(--font-mono)',
        lineHeight: '1.55',
        maxHeight: '190px',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--text-3)',
        border: 'none',
      },
      '.cm-content': {
        minHeight: '64px',
        caretColor: 'var(--accent)',
      },
      '.cm-activeLine': { backgroundColor: 'var(--hover)' },
      '.cm-activeLineGutter': { backgroundColor: 'var(--hover)' },
      '.cm-tooltip': {
        backgroundColor: 'var(--panel-bg)',
        color: 'var(--text-1)',
        border: '1px solid var(--border)',
      },
      '.cm-tooltip-autocomplete > ul > li': {
        fontFamily: 'var(--font-mono)',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--accent-weak)',
        color: 'var(--text-1)',
      },
    },
    { dark },
  );
}

const WORD_CHAR = /[\p{L}\p{N}_$]/u;

function wordAt(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  let start = Math.min(Math.max(pos - line.from, 0), line.text.length);
  if (
    (start === line.text.length || !WORD_CHAR.test(line.text[start] ?? '')) &&
    start > 0 &&
    WORD_CHAR.test(line.text[start - 1])
  ) {
    start -= 1;
  }
  if (start >= line.text.length || !WORD_CHAR.test(line.text[start])) return null;

  let end = start;
  while (end < line.text.length && WORD_CHAR.test(line.text[end])) end += 1;
  const word = line.text.slice(start, end);
  return { word, from: line.from + start, to: line.from + end };
}

function buildHoverDom(
  word: string,
  tables: DbTableSchema[],
  labels: { type: string; comment: string; columns: string; primaryKey: string },
): HTMLElement | null {
  const lower = word.toLowerCase();
  const tableMatches = tables.filter(
    (table) => table.table.toLowerCase() === lower,
  );
  const columnMatches: { table: DbTableSchema; column: DbTableSchema['columns'][number] }[] =
    [];
  for (const table of tables) {
    for (const column of table.columns) {
      if (column.name.toLowerCase() === lower) {
        columnMatches.push({ table, column });
      }
    }
  }
  if (tableMatches.length === 0 && columnMatches.length === 0) return null;

  const dom = document.createElement('div');
  dom.className = 'sql-hover';

  for (const table of tableMatches) {
    const title = document.createElement('div');
    title.className = 'sql-hover__title';
    title.textContent = table.table;
    dom.appendChild(title);

    if (table.comment) {
      const comment = document.createElement('div');
      comment.className = 'sql-hover__muted';
      comment.textContent = table.comment;
      dom.appendChild(comment);
    }
    const count = document.createElement('div');
    count.className = 'sql-hover__muted';
    count.textContent = `${labels.columns}: ${table.columns.length}`;
    dom.appendChild(count);
  }

  for (const { table, column } of columnMatches.slice(0, 8)) {
    const title = document.createElement('div');
    title.className = 'sql-hover__title';
    title.textContent = `${table.table}.${column.name}`;
    if (column.primaryKey) {
      const pk = document.createElement('span');
      pk.className = 'sql-hover__badge';
      pk.textContent = labels.primaryKey;
      title.appendChild(pk);
    }
    dom.appendChild(title);

    if (column.type) {
      const type = document.createElement('div');
      type.className = 'sql-hover__muted';
      type.textContent = `${labels.type}: ${column.type}`;
      dom.appendChild(type);
    }
    if (column.comment) {
      const comment = document.createElement('div');
      comment.className = 'sql-hover__muted';
      comment.textContent = `${labels.comment}: ${column.comment}`;
      dom.appendChild(comment);
    }
  }

  if (columnMatches.length > 8) {
    const more = document.createElement('div');
    more.className = 'sql-hover__muted';
    more.textContent = `+${columnMatches.length - 8}`;
    dom.appendChild(more);
  }
  return dom;
}

/**
 * 数据库预览 SQL 编辑器：CodeMirror 6 + 方言高亮 + 表/字段补全 + 悬浮信息。
 * 不实现独立 LSP，补全完全基于已加载的表结构，不额外请求数据库。
 */
export function SqlEditor({
  value,
  onChange,
  onRun,
  tables,
  driver,
  defaultTable,
  dark,
  ariaLabel,
}: SqlEditorProps) {
  const { t } = useTranslation('database');
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const [lintMessage, setLintMessage] = useState<string | null>(null);
  const [lintLine, setLintLine] = useState<number | null>(null);
  const [lintCount, setLintCount] = useState(0);
  const lintSeq = useRef(0);
  const tRef = useRef(t);
  tRef.current = t;

  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const valueRef = useRef(value);
  const tablesRef = useRef(tables);
  const labelsRef = useRef({
    type: t('colType'),
    comment: t('colComment'),
    columns: t('columns'),
    primaryKey: t('primaryKey'),
  });
  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  valueRef.current = value;
  tablesRef.current = tables;
  labelsRef.current = {
    type: t('colType'),
    comment: t('colComment'),
    columns: t('columns'),
    primaryKey: t('primaryKey'),
  };

  const language = useMemo(
    () =>
      sql({
        dialect: dialectFor(driver),
        schema: buildSchema(tables),
        defaultTable,
        upperCaseKeywords: true,
      }),
    [driver, tables, defaultTable],
  );
  const languageRef = useRef(language);
  languageRef.current = language;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      doc: valueRef.current,
      parent: host,
      extensions: [
        basicSetup,
        languageCompartment.current.of(languageRef.current),
        themeCompartment.current.of(editorTheme(dark)),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          'aria-label': ariaLabel,
          spellcheck: 'false',
        }),
        hoverTooltip((view, pos) => {
          const hit = wordAt(view, pos);
          if (!hit) return null;
          const dom = buildHoverDom(
            hit.word,
            tablesRef.current,
            labelsRef.current,
          );
          if (!dom) return null;
          return {
            pos: hit.from,
            end: hit.to,
            create: () => ({ dom }),
          };
        }),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              onRunRef.current();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 编辑器实例只创建一次；语言、主题和值分别通过 Compartment / effect 同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartment.current.reconfigure(language),
    });
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.current.reconfigure(editorTheme(dark)),
    });
  }, [dark]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const sql = value;
    const seq = ++lintSeq.current;
    const controller = new AbortController();
    const translate = tRef.current;
    view.dispatch(setDiagnostics(view.state, []));
    setLintMessage(null);
    setLintLine(null);
    setLintCount(0);
    if (!sql.trim()) return () => controller.abort();

    const timer = window.setTimeout(() => {
      void validateDbSql(driver, sql, controller.signal)
        .then((result) => {
          if (seq !== lintSeq.current) return;
          const currentView = viewRef.current;
          if (!currentView || currentView.state.doc.toString() !== sql) return;

          const messages = new Map<DbSqlDiagnostic, string>();
          const diagnostics: Diagnostic[] = result.errors.map((error) => {
            const from = Math.max(0, Math.min(error.from, sql.length));
            let to = Math.max(from, Math.min(error.to, sql.length));
            if (to === from && from < sql.length) to = from + 1;
            const message = translate(`sqlDiagnostic.${error.reason}`, {
              token: error.token ?? '',
              defaultValue: error.message,
            });
            messages.set(error, message);
            return {
              from,
              to,
              severity: 'error',
              message,
              source: 'sql',
            };
          });
          currentView.dispatch(setDiagnostics(currentView.state, diagnostics));
          const first = result.errors[0];
          setLintMessage(first ? (messages.get(first) ?? first.message) : null);
          setLintLine(first?.line ?? null);
          setLintCount(result.errors.length);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (seq !== lintSeq.current) return;
          // 校验服务不可用时保持编辑器可用，不额外打扰用户。
          setLintMessage(null);
          setLintLine(null);
          setLintCount(0);
        });
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value, driver]);

  return (
    <div className="dbdata__sql">
      <div className="dbdata__sql-editor" ref={hostRef} />
      {lintMessage && (
        <div
          className="dbdata__sql-diagnostic"
          role="status"
          aria-label={t('sqlSyntaxError')}
        >
          <span className="dbdata__sql-diagnostic-message">
            {lintLine ? `${t('sqlLine', { line: lintLine })} · ` : ''}
            {lintMessage}
          </span>
          {lintCount > 1 && (
            <span className="dbdata__sql-diagnostic-count">
              {t('sqlErrorCount', { count: lintCount })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
