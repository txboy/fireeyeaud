import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { ConfigScope, DbDriver } from '@fireeyeaud/shared';
import { ScopeBadge } from '../ScopeBadge';
import { useDatabaseStore } from '../../store/database';
import { useWorkspaceStore } from '../../store/workspace';

const DRIVERS: DbDriver[] = ['sqlite', 'access', 'postgresql', 'mysql', 'mssql'];

interface FormState {
  name: string;
  driver: DbDriver;
  scope: ConfigScope;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  path: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  driver: 'sqlite',
  scope: 'project',
  host: '',
  port: '',
  database: '',
  username: '',
  password: '',
  path: '',
};

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
  const create = useDatabaseStore((s) => s.create);
  const remove = useDatabaseStore((s) => s.remove);
  const test = useDatabaseStore((s) => s.test);
  const reflect = useDatabaseStore((s) => s.reflect);
  const setAuthDraft = useDatabaseStore((s) => s.setAuthDraft);
  const saveAuthorization = useDatabaseStore((s) => s.saveAuthorization);
  const path = useWorkspaceStore((s) => s.path);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [testOk, setTestOk] = useState<Record<string, boolean>>({});
  const [openCols, setOpenCols] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (path) void load();
  }, [load, path]);

  const isFile = form.driver === 'sqlite' || form.driver === 'access';

  const submit = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    const ok = await create({
      name: form.name.trim(),
      driver: form.driver,
      scope: form.scope,
      path: isFile ? form.path.trim() : undefined,
      host: isFile ? undefined : form.host.trim() || undefined,
      port: isFile || !form.port ? undefined : Number(form.port),
      database: isFile ? undefined : form.database.trim() || undefined,
      username: isFile ? undefined : form.username.trim() || undefined,
      password: form.password || undefined,
    });
    setBusy(false);
    if (ok) {
      setShowForm(false);
      setForm(EMPTY_FORM);
    }
  };

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
        onClick={() => setShowForm((v) => !v)}
      >
        <Plus size={12} strokeWidth={2} /> {t('addConnection')}
      </button>

      {showForm && (
        <div className="card db-form">
          <input
            className="searchbox"
            placeholder={t('name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <select
            className="searchbox"
            value={form.driver}
            onChange={(e) => setForm({ ...form, driver: e.target.value as DbDriver })}
          >
            {DRIVERS.map((d) => (
              <option key={d} value={d}>
                {te(`driver.${d}`)}
              </option>
            ))}
          </select>
          {isFile ? (
            <input
              className="searchbox"
              placeholder={t('path')}
              value={form.path}
              onChange={(e) => setForm({ ...form, path: e.target.value })}
            />
          ) : (
            <>
              <input
                className="searchbox"
                placeholder={t('host')}
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
              />
              <input
                className="searchbox"
                placeholder={t('port')}
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
              />
              <input
                className="searchbox"
                placeholder={t('database')}
                value={form.database}
                onChange={(e) => setForm({ ...form, database: e.target.value })}
              />
              <input
                className="searchbox"
                placeholder={t('username')}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
              <input
                className="searchbox"
                type="password"
                placeholder={t('password')}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </>
          )}
          <div className="card__row">
            <select
              className="searchbox"
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as ConfigScope })}
            >
              <option value="project">{te('configScope.project')}</option>
              <option value="global">{te('configScope.global')}</option>
            </select>
            <span className="spacer" />
            <button
              type="button"
              className="button button--sm"
              disabled={busy || !form.name.trim()}
              onClick={() => void submit()}
            >
              {t('save')}
            </button>
            <button
              type="button"
              className="button button--sm button--ghost"
              onClick={() => setShowForm(false)}
            >
              {t('cancel')}
            </button>
          </div>
          <span className="card__meta">{t('sqliteHint')}</span>
        </div>
      )}

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
