import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { ScopeBadge } from '../ScopeBadge';
import { useDatabaseStore } from '../../store/database';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';

export function DatabasePanel() {
  const { t } = useTranslation('database');
  const { t: te } = useTranslation('enums');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');

  const items = useDatabaseStore((s) => s.items);
  const loading = useDatabaseStore((s) => s.loading);
  const errorKey = useDatabaseStore((s) => s.errorKey);
  const reflectByConn = useDatabaseStore((s) => s.reflectByConn);
  const authByConn = useDatabaseStore((s) => s.authByConn);
  const load = useDatabaseStore((s) => s.load);
  const remove = useDatabaseStore((s) => s.remove);
  const test = useDatabaseStore((s) => s.test);
  const reflect = useDatabaseStore((s) => s.reflect);
  const setAuthDraft = useDatabaseStore((s) => s.setAuthDraft);
  const saveAuthorization = useDatabaseStore((s) => s.saveAuthorization);
  const openForm = useUiStore((s) => s.openForm);
  const path = useWorkspaceStore((s) => s.path);

  const [testOk, setTestOk] = useState<Record<string, boolean>>({});
  const [openCols, setOpenCols] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (path) void load();
  }, [load, path]);

  const draft = (id: string) => authByConn[id] ?? {};

  const toggleTable = (id: string, table: string) => {
    const cur = { ...draft(id) };
    if (table in cur) delete cur[table];
    else cur[table] = ['*'];
    setAuthDraft(id, cur);
  };

  const toggleColumn = (id: string, table: string, column: string) => {
    const cur = { ...draft(id) };
    const list = cur[table]?.includes('*') ? [] : [...(cur[table] ?? [])];
    const idx = list.indexOf(column);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(column);
    cur[table] = list;
    setAuthDraft(id, cur);
  };

  if (!path) {
    return (
      <div className="panel-empty">
        <span>{tc('noWorkspace')}</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="button button--sm"
        onClick={() => void openForm('database', 'create')}
      >
        <Plus size={12} strokeWidth={2} /> {t('addConnection')}
      </button>

      {errorKey && (
        <div className="panel-error">
          {terr(errorKey.replace(/^error\./, ''))}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="panel-empty">
          <span>{tc('loading')}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="panel-empty">
          <span>{t('empty')}</span>
        </div>
      ) : (
        items.map((conn) => {
          const tables = reflectByConn[conn.id];
          return (
            <div key={conn.id} className="card">
              <div className="card__row">
                <span
                  className="status-dot"
                  style={{
                    background:
                      testOk[conn.id] === true
                        ? 'var(--success)'
                        : testOk[conn.id] === false
                          ? 'var(--danger, #d9480f)'
                          : 'var(--text-3)',
                  }}
                />
                <span className="card__name">{conn.name}</span>
                <span className="scope-badge">{te(`driver.${conn.driver}`)}</span>
                <ScopeBadge scope={conn.scope} />
                <span className="spacer" />
                <button
                  type="button"
                  className="button button--sm"
                  onClick={() =>
                    void test(conn.id, conn.scope).then((ok) =>
                      setTestOk((prev) => ({ ...prev, [conn.id]: ok })),
                    )
                  }
                >
                  {t('test')}
                </button>
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  onClick={() => void reflect(conn.id, conn.scope)}
                >
                  {t('reflect')}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title={tc('edit')}
                  onClick={() =>
                    void openForm('database', 'edit', {
                      id: conn.id,
                      scope: conn.scope,
                      name: conn.name,
                    })
                  }
                >
                  <Pencil size={13} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  onClick={() => void remove(conn.id, conn.scope)}
                >
                  <Trash2 size={12} strokeWidth={2} />
                </button>
              </div>
              {testOk[conn.id] === true && (
                <span className="card__meta">{t('testOk')}</span>
              )}

              {tables && (
                <div className="db-tables">
                  <div className="card__meta">{t('tables')}</div>
                  {tables.length === 0 && (
                    <span className="card__meta">{tc('notConfigured')}</span>
                  )}
                  {tables.map((tb) => {
                    const cols = draft(conn.id)[tb.table];
                    const checked = cols !== undefined;
                    const allCols = cols?.includes('*') ?? false;
                    const colOpen = openCols[`${conn.id}:${tb.table}`];
                    return (
                      <div key={tb.table} className="db-table">
                        <div className="card__row">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTable(conn.id, tb.table)}
                          />
                          <span style={{ fontSize: 12 }}>{tb.table}</span>
                          {checked && (
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() =>
                                setOpenCols((prev) => ({
                                  ...prev,
                                  [`${conn.id}:${tb.table}`]: !prev[`${conn.id}:${tb.table}`],
                                }))
                              }
                            >
                              {colOpen ? (
                                <ChevronDown size={12} strokeWidth={2} />
                              ) : (
                                <ChevronRight size={12} strokeWidth={2} />
                              )}
                              {t('columns')}
                            </button>
                          )}
                          {allCols && <span className="card__meta">{t('selectAll')}</span>}
                        </div>
                        {checked && colOpen && (
                          <div className="db-cols">
                            {allCols && (
                              <span className="card__meta">{t('selectAll')}</span>
                            )}
                            {tb.columns.map((c) => (
                              <label key={c.name} className="db-col">
                                <input
                                  type="checkbox"
                                  checked={allCols || (cols ?? []).includes(c.name)}
                                  disabled={allCols}
                                  onChange={() =>
                                    toggleColumn(conn.id, tb.table, c.name)
                                  }
                                />
                                <span>{c.name}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="button button--sm"
                    onClick={() =>
                      void saveAuthorization(
                        conn.id,
                        Object.fromEntries(
                          Object.entries(draft(conn.id)).filter(([, v]) => v.length > 0),
                        ),
                      )
                    }
                  >
                    {t('saveAuth')}
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
