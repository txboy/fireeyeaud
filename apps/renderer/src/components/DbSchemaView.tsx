import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  KeyRound,
  RefreshCw,
  Save,
  Table2,
} from 'lucide-react';
import type { DbColumn, DbTableSchema } from '@fireeyeaud/shared';
import { useDatabaseStore } from '../store/database';
import { useDatasourcesStore } from '../store/datasources';
import { useUiStore, type DbSchemaTab } from '../store/ui';

/** 表 / 字段授权：每张表一个表格，展示字段、类型、注释并勾选允许范围。 */
export function DbSchemaView({ tab }: { tab: DbSchemaTab }) {
  const { t } = useTranslation('database');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');

  const reflect = useDatabaseStore((s) => s.reflect);
  const saveAuthorization = useDatabaseStore((s) => s.saveAuthorization);
  const setAuthDraft = useDatabaseStore((s) => s.setAuthDraft);
  const errorKey = useDatabaseStore((s) => s.errorKey);
  const reflectByConn = useDatabaseStore((s) => s.reflectByConn);
  const authByConn = useDatabaseStore((s) => s.authByConn);
  const connections = useDatabaseStore((s) => s.items);
  const openDbData = useUiStore((s) => s.openDbData);
  const tables = reflectByConn[tab.connectionId];
  const draft = authByConn[tab.connectionId] ?? {};

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    setSaved(false);
    try {
      await reflect(tab.connectionId, tab.scope);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // 连接或作用域变化时重新读取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.connectionId, tab.scope]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!tables) return [];
    if (!q) return tables.map((tb) => ({ table: tb, columns: tb.columns }));
    const result: { table: DbTableSchema; columns: DbColumn[] }[] = [];
    for (const tb of tables) {
      const tableHit = tb.table.toLowerCase().includes(q);
      const colHit = (c: DbColumn) =>
        c.name.toLowerCase().includes(q) ||
        (c.comment ?? '').toLowerCase().includes(q);
      if (tableHit) {
        result.push({ table: tb, columns: tb.columns });
      } else {
        const cols = tb.columns.filter(colHit);
        if (cols.length) result.push({ table: tb, columns: cols });
      }
    }
    return result;
  }, [tables, q]);

  const update = (next: Record<string, string[]>) => {
    setAuthDraft(tab.connectionId, next);
    setSaved(false);
  };

  const isTableAll = (table: string) => draft[table]?.includes('*') ?? false;
  const isColumnAllowed = (table: string, column: string) => {
    const list = draft[table];
    if (!list) return false;
    return list.includes('*') || list.includes(column);
  };

  const toggleTable = (tb: DbTableSchema) => {
    const next = { ...draft };
    if (tb.table in next) delete next[tb.table];
    else next[tb.table] = ['*'];
    update(next);
  };

  const toggleColumn = (tb: DbTableSchema, column: string) => {
    const next = { ...draft };
    const list = next[tb.table];
    if (!list) {
      next[tb.table] = [column];
    } else if (list.includes('*')) {
      // 从「整表」收窄为显式列表（排除该列）。
      next[tb.table] = tb.columns.map((c) => c.name).filter((n) => n !== column);
    } else {
      const cols = [...list];
      const idx = cols.indexOf(column);
      if (idx >= 0) cols.splice(idx, 1);
      else cols.push(column);
      if (cols.length === 0) delete next[tb.table];
      else next[tb.table] = cols;
    }
    update(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const cleaned = Object.fromEntries(
        Object.entries(draft).filter(([, v]) => v.length > 0),
      );
      await saveAuthorization(tab.connectionId, cleaned);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const setAllExpanded = (value: boolean) => {
    if (!value) {
      setExpanded({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const tb of tables ?? []) next[tb.table] = true;
    setExpanded(next);
  };

  const authorizedCount = (tb: DbTableSchema) => {
    const list = draft[tb.table];
    if (!list) return 0;
    if (list.includes('*')) return tb.columns.length;
    return list.length;
  };

  // 后台还在准备项目数据时，读不到表不是「表不存在」，而是还没导入完。
  const tablesEmptyHint = useDatasourcesStore((s) => Boolean(s.backgroundSync));

  return (
    <div className="dbschema">
      <div className="dbschema__bar">
        <span className="dbschema__name">{tab.name}</span>
        <input
          className="searchbox dbschema__search"
          value={query}
          placeholder={t('schemaSearch')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="spacer" />
        <button
          type="button"
          className="button button--sm button--ghost"
          onClick={() => setAllExpanded(true)}
        >
          {t('expandAll')}
        </button>
        <button
          type="button"
          className="button button--sm button--ghost"
          onClick={() => setAllExpanded(false)}
        >
          {t('collapseAll')}
        </button>
        <button
          type="button"
          className="button button--sm button--ghost"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={12} strokeWidth={2} /> {t('refresh')}
        </button>
        <button
          type="button"
          className="button button--sm"
          onClick={() => void save()}
          disabled={saving}
        >
          <Save size={12} strokeWidth={2} /> {t('saveAuth')}
        </button>
      </div>

      {errorKey && (
        <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
      )}
      {!tables && !loading && tablesEmptyHint && (
        <div className="panel-hint panel-hint--progress" role="status">
          <RefreshCw size={12} strokeWidth={2} />
          <span>{t('dataPreparing')}</span>
        </div>
      )}
      {saved && !errorKey && (
        <div className="dbschema__saved">{tc('save')} ✓</div>
      )}

      <div className="dbschema__body">
        {loading && !tables ? (
          <div className="panel-empty">
            <span>{tc('loading')}</span>
          </div>
        ) : visible.length === 0 ? (
          <div className="panel-empty">
            <span>{tables ? t('schemaEmpty') : t('schemaReading')}</span>
          </div>
        ) : (
          visible.map(({ table, columns }) => {
            const cols = columns;
            // 默认收起；搜索时自动展开命中的表，便于看到匹配字段。
            const isExpanded = q ? true : (expanded[table.table] ?? false);
            const count = authorizedCount(table);
            return (
              <section key={table.table} className="dbschema__table">
                <header className="dbschema__table-head">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() =>
                      setExpanded((prev) => ({
                        ...prev,
                        [table.table]: !(prev[table.table] ?? false),
                      }))
                    }
                  >
                    {isExpanded ? (
                      <ChevronDown size={13} strokeWidth={2} />
                    ) : (
                      <ChevronRight size={13} strokeWidth={2} />
                    )}
                    <span className="dbschema__table-name">{table.table}</span>
                  </button>
                  {table.comment ? (
                    <span className="card__meta">{table.comment}</span>
                  ) : null}
                  <span className="spacer" />
                  <span className="card__meta">
                    {t('selectedColumns', { count, total: table.columns.length })}
                  </span>
                  <button
                    type="button"
                    className="button button--sm button--ghost"
                    title={t('preview')}
                    onClick={() => {
                      const conn = connections.find(
                        (c) => c.id === tab.connectionId,
                      );
                      void openDbData({
                        id: tab.connectionId,
                        scope: tab.scope,
                        name: tab.name,
                        driver: conn?.driver ?? 'sqlite',
                        table,
                      });
                    }}
                  >
                    <Table2 size={13} strokeWidth={1.9} /> {t('preview')}
                  </button>
                  <label className="dbschema__allow">
                    <input
                      type="checkbox"
                      checked={isTableAll(table.table)}
                      onChange={() => toggleTable(table)}
                    />
                    <span>{t('tableAll')}</span>
                  </label>
                </header>
                {isExpanded && (
                  <table className="dbschema__grid">
                    <thead>
                      <tr>
                        <th>{t('colName')}</th>
                        <th>{t('colType')}</th>
                        <th>{t('colComment')}</th>
                        <th className="dbschema__col-allow">{t('colAllow')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cols.map((c) => (
                        <tr key={c.name}>
                          <td>
                            <span className="dbschema__col-name">
                              {c.primaryKey && (
                                <KeyRound
                                  size={11}
                                  strokeWidth={2}
                                  className="dbschema__pk"
                                />
                              )}
                              {c.name}
                            </span>
                          </td>
                          <td className="dbschema__col-type">{c.type}</td>
                          <td className="dbschema__col-comment">
                            {c.comment || '—'}
                          </td>
                          <td className="dbschema__col-allow">
                            <input
                              type="checkbox"
                              checked={isColumnAllowed(table.table, c.name)}
                              onChange={() => toggleColumn(table, c.name)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
