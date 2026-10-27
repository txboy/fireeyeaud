import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Copy, Check, Play, Sparkles } from 'lucide-react';
import type { DbDriver, DbQueryResult, DbTableSchema } from '@fireeyeaud/shared';
import { runDbQuery, runWorkspaceQuery, getWorkspaceTableSchema } from '../lib/api';
import { useDatabaseStore } from '../store/database';
import { useDbSqlAssistantStore } from '../store/dbSqlAssistant';
import { useSettingsStore } from '../store/settings';
import type { DbDataTab } from '../store/ui';
import { DbSqlAssistantPanel } from './DbSqlAssistantPanel';
import { errorKeyOf } from '../lib/errorKey';

// CodeMirror / SQL 语言包按需加载，避免进入主包。
const SqlEditor = lazy(() =>
  import('./SqlEditor').then((module) => ({ default: module.SqlEditor })),
);

const PAGE_SIZES = [20, 50, 100, 200];

/** 按驱动转义标识符。 */
function quoteIdent(driver: DbDriver, name: string): string {
  if (driver === 'mysql') return `\`${name.replace(/`/g, '``')}\``;
  if (driver === 'mssql' || driver === 'access') {
    return `[${name.replace(/]/g, ']]')}]`;
  }
  // PostgreSQL / SQLite / Oracle 均用双引号（Oracle 亦为 "..."）。
  return `"${name.replace(/"/g, '""')}"`;
}

/** 默认查询：整表；有主键则按主键排序，保证翻页稳定。 */
function defaultSql(table: DbTableSchema, driver: DbDriver): string {
  const target = quoteIdent(driver, table.table);
  const pk = table.columns.find((c) => c.primaryKey);
  return pk
    ? `SELECT * FROM ${target} ORDER BY ${quoteIdent(driver, pk.name)}`
    : `SELECT * FROM ${target}`;
}

/** 单元格文本：null → —，对象（JSON 等）→ 序列化。 */
function formatCell(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** 表数据预览：编辑 SQL、运行、分页查看结果。 */
export function DbDataView({ tab }: { tab: DbDataTab }) {
  const { t } = useTranslation('database');
  const { t: terr } = useTranslation('error');

  const initialSql = useRef(defaultSql(tab.table, tab.driver));
  const [sql, setSql] = useState(initialSql.current);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<DbQueryResult | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reflectByConn = useDatabaseStore((s) => s.reflectByConn);
  const dark = useSettingsStore((s) => s.theme === 'dark');

  // SQL 助手面板开合按 tab 记录：切到别的表再回来保持原状态。
  const assistantOpen = useDbSqlAssistantStore((s) => s.threads[tab.id]?.open ?? false);
  const setAssistantOpen = useDbSqlAssistantStore((s) => s.setOpen);
  // 文件型数据源：表结构与字段补全来自工作区 DuckDB（不进 reflectByConn 缓存）。
  const [duckSchema, setDuckSchema] = useState<DbTableSchema | null>(null);

  // 补全尽量使用整个连接的最新反射结果；尚未反射时回退到当前预览表。
  const tables = useMemo(() => {
    const byName = new Map<string, DbTableSchema>();
    if (tab.source !== 'workspace-duckdb') {
      for (const table of reflectByConn[tab.connectionId] ?? []) {
        byName.set(table.table, table);
      }
    }
    if (duckSchema) byName.set(duckSchema.table, duckSchema);
    if (!byName.has(tab.table.table)) byName.set(tab.table.table, tab.table);
    return [...byName.values()];
  }, [reflectByConn, tab.connectionId, tab.source, tab.table, duckSchema]);

  useEffect(() => {
    if (tab.source !== 'workspace-duckdb') return;
    let cancelled = false;
    getWorkspaceTableSchema(tab.table.table)
      .then((schema) => {
        if (!cancelled) setDuckSchema(schema);
      })
      .catch(() => {
        /* 结构拿不到不影响查询：回退到打开 tab 时带进来的表结构。 */
      });
    return () => {
      cancelled = true;
    };
  }, [tab.source, tab.table.table]);

  const copySql = async () => {
    const text = result?.sql ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 回退：临时 textarea + execCommand（file:// 等非安全上下文）。
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const fetchPage = async (
    nextPage: number,
    includeTotal: boolean,
    size: number,
    sqlOverride?: string,
  ) => {
    // 「AI 直接运行」不能依赖 setSql 后的异步 state，必须显式传入 SQL。
    const execSql = sqlOverride ?? sql;
    setBusy(true);
    setErrorKey(null);
    try {
      const payload = {
        sql: execSql,
        limit: size,
        offset: (nextPage - 1) * size,
        includeTotal,
      };
      // 文件型数据源的表在工作区 DuckDB 里，走另一条只读接口。
      const res =
        tab.source === 'workspace-duckdb'
          ? await runWorkspaceQuery(payload)
          : await runDbQuery(tab.connectionId, tab.scope, payload);
      setResult(res);
      if (includeTotal) setTotal(res.total);
      setPage(nextPage);
    } catch (err) {
      setErrorKey(errorKeyOf(err));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const handleRun = () => {
    if (busy || !sql.trim()) return;
    void fetchPage(1, true, pageSize);
  };

  // 初次载入：跑默认 SQL 第 1 页并统计总数。
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void fetchPage(1, true, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pageCount =
    total != null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const canPrev = page > 1 && !busy;
  const canNext =
    !busy && (pageCount != null ? page < pageCount : (result?.hasMore ?? false));

  const rows = result?.rows ?? [];
  const columns = result?.columns ?? [];
  const paginated = result?.paginated ?? true;

  const renderPager = () => (
    <div className="dbdata__pager dbdata__pager--bottom">
      <span className="card__meta">
        {t('totalRows', { count: total ?? result?.rowCount ?? 0 })}
      </span>
      {paginated ? (
        <>
          <button
            type="button"
            className="icon-btn"
            disabled={!canPrev}
            title={t('prevPage')}
            onClick={() => void fetchPage(page - 1, false, pageSize)}
          >
            <ChevronLeft size={14} strokeWidth={2} />
          </button>
          <span className="card__meta">
            {pageCount != null
              ? t('pageOf', { page, total: pageCount })
              : t('pageNo', { page })}
          </span>
          <button
            type="button"
            className="icon-btn"
            disabled={!canNext}
            title={t('nextPage')}
            onClick={() => void fetchPage(page + 1, false, pageSize)}
          >
            <ChevronRight size={14} strokeWidth={2} />
          </button>
          <label className="dbdata__pagesize">
            <span className="card__meta">{t('pageSize')}</span>
            <select
              className="searchbox"
              value={pageSize}
              onChange={(e) => {
                const size = Number(e.target.value);
                setPageSize(size);
                void fetchPage(1, false, size);
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <span className="card__meta">{t('noPaging')}</span>
      )}
    </div>
  );

  return (
    <div className={`formtab dbdata${assistantOpen ? ' dbdata--with-assistant' : ''}`}>
      <div className="formtab__head">
        <Play size={14} strokeWidth={1.75} />
        <span className="formtab__title">
          {tab.name} / {tab.table.table}
        </span>
      </div>

      <div className="dbdata__body">
        <div className="dbdata__main">
          <div className="dbdata__editor">
            <Suspense
              fallback={
                <div
                  className="dbdata__sql-editor dbdata__sql-editor--loading"
                  aria-busy="true"
                />
              }
            >
              <SqlEditor
                value={sql}
                onChange={setSql}
                onRun={handleRun}
                tables={tables}
                driver={tab.driver}
                defaultTable={tab.table.table}
                dark={dark}
                ariaLabel={t('dataSql')}
              />
            </Suspense>
            <div className="dbdata__actions">
              {busy && <span className="card__meta">{t('loadingRows')}</span>}
              {/* 工作区 DuckDB 的表没有对应的数据库连接，AI 助手不适用。 */}
              {tab.source !== 'workspace-duckdb' && (
                <button
                  type="button"
                  className={`button button--sm button--ghost${
                    assistantOpen ? ' button--active' : ''
                  }`}
                  aria-pressed={assistantOpen}
                  title={t('aiGenerateSql')}
                  onClick={() => setAssistantOpen(tab.id, !assistantOpen)}
                >
                  <Sparkles size={13} strokeWidth={1.9} /> {t('aiGenerateSql')}
                </button>
              )}
              <button
                type="button"
                className="button button--sm"
                disabled={busy || !sql.trim()}
                onClick={handleRun}
              >
                <Play size={13} strokeWidth={1.9} /> {t('run')}
              </button>
            </div>
            {errorKey && (
              <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
            )}
          </div>

          {result && (
            <>
              <div className="dbdata__execsql">
                <div className="dbdata__execsql-head">
                  <span className="card__meta">{t('executedSql')}</span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="button button--sm button--ghost"
                    onClick={() => void copySql()}
                  >
                    {copied ? (
                      <Check size={13} strokeWidth={2} />
                    ) : (
                      <Copy size={13} strokeWidth={1.75} />
                    )}{' '}
                    {copied ? t('copied') : t('copy')}
                  </button>
                </div>
                <pre className="dbdata__sqltag">{result.sql}</pre>
              </div>

              <div className="dbdata__result">
                {rows.length === 0 ? (
                  <div className="panel-empty">
                    <span>{t('noRows')}</span>
                  </div>
                ) : (
                  <table className="dbdata__table">
                    <thead>
                      <tr>
                        {columns.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          {r.map((v, j) => (
                            <td key={j}>{formatCell(v)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {renderPager()}
            </>
          )}
        </div>

        {assistantOpen && (
          <DbSqlAssistantPanel
            tab={tab}
            sql={sql}
            tables={tables}
            result={result}
            error={errorKey ? terr(errorKey.replace(/^error\./, '')) : null}
            page={page}
            pageSize={pageSize}
            total={total}
            onInsert={(next) => setSql(next)}
            onRun={(next) => {
              setSql(next);
              void fetchPage(1, true, pageSize, next);
            }}
            onClose={() => setAssistantOpen(tab.id, false)}
          />
        )}
      </div>
    </div>
  );
}
