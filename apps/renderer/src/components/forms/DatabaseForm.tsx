import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, FolderOpen, Zap } from 'lucide-react';
import type { ConfigScope, DbConnection, DbDriver } from '@fireeyeaud/shared';
import { useDatabaseStore } from '../../store/database';
import { useWorkspaceStore } from '../../store/workspace';
import { FormActions } from './FormActions';
import { FormError } from './FormError';
import { useUnsavedGuard } from './UnsavedGuard';

/** 上传的数据库文件复制到工作区此可见目录。 */
const DB_UPLOAD_DIR = '数据库';

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
  isDefault: boolean;
}

const EMPTY: FormState = {
  name: '',
  driver: 'sqlite',
  scope: 'project',
  host: '',
  port: '',
  database: '',
  username: '',
  password: '',
  path: '',
  isDefault: false,
};

function init(entity?: DbConnection): FormState {
  if (!entity) return EMPTY;
  return {
    name: entity.name,
    driver: entity.driver,
    scope: entity.scope,
    host: entity.host ?? '',
    port: entity.port != null ? String(entity.port) : '',
    database: entity.database ?? '',
    username: entity.username ?? '',
    password: '',
    path: entity.path ?? '',
    isDefault: Boolean(entity.isDefault),
  };
}

export function DatabaseForm({
  entity,
  onSaved,
  onCancel,
}: {
  entity?: DbConnection;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('database');
  const { t: te } = useTranslation('enums');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const create = useDatabaseStore((s) => s.create);
  const edit = useDatabaseStore((s) => s.edit);
  const testParams = useDatabaseStore((s) => s.testParams);
  const errorKey = useDatabaseStore((s) => s.errorKey);
  const reflectByConn = useDatabaseStore((s) => s.reflectByConn);
  const authByConn = useDatabaseStore((s) => s.authByConn);
  const reflect = useDatabaseStore((s) => s.reflect);
  const setAuthDraft = useDatabaseStore((s) => s.setAuthDraft);
  const saveAuthorization = useDatabaseStore((s) => s.saveAuthorization);
  const root = useWorkspaceStore((s) => s.path);

  const initialRef = useRef<FormState>(init(entity));
  const [form, setForm] = useState<FormState>(initialRef.current);
  const [busy, setBusy] = useState(false);
  const [testStatus, setTestStatus] = useState<'ok' | 'fail' | null>(null);
  const [openCols, setOpenCols] = useState<Record<string, boolean>>({});
  const [localError, setLocalError] = useState<string | null>(null);

  const isFile = form.driver === 'sqlite' || form.driver === 'access';
  const dirty = JSON.stringify(form) !== JSON.stringify(initialRef.current);

  const tables = entity ? reflectByConn[entity.id] : undefined;
  const draft = entity ? (authByConn[entity.id] ?? {}) : {};

  const toggleTable = (table: string) => {
    if (!entity) return;
    const cur = { ...draft };
    if (table in cur) delete cur[table];
    else cur[table] = ['*'];
    setAuthDraft(entity.id, cur);
  };

  const toggleColumn = (table: string, column: string) => {
    if (!entity) return;
    const cur = { ...draft };
    const list = cur[table]?.includes('*') ? [] : [...(cur[table] ?? [])];
    const idx = list.indexOf(column);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(column);
    cur[table] = list;
    setAuthDraft(entity.id, cur);
  };

  const runTest = async () => {
    const ok = await testParams({
      driver: form.driver,
      host: isFile ? null : form.host.trim() || null,
      port: isFile || !form.port ? null : Number(form.port),
      database: isFile ? null : form.database.trim() || null,
      username: isFile ? null : form.username.trim() || null,
      path: isFile ? form.path.trim() || null : null,
      password: form.password || null,
      id: entity?.id,
      scope: entity?.scope,
    });
    setTestStatus(ok ? 'ok' : 'fail');
  };

  /** 选择本地数据库文件并复制到工作区，路径写回表单。 */
  const chooseFile = async () => {
    const api = window.fireeyeaud;
    if (!api || !root) return;
    const files = await api.openFiles('database', { driver: form.driver });
    const sourcePath = files[0];
    if (!sourcePath) return;
    const res = await api.copyFiles({
      root,
      targetDir: `${root}/${DB_UPLOAD_DIR}`,
      sourcePaths: [sourcePath],
    });
    if (res.ok && res.paths?.[0]) {
      setLocalError(null);
      setForm((prev) => ({ ...prev, path: res.paths![0] }));
    } else {
      setLocalError(terr('opFailed'));
    }
  };

  const save = async (): Promise<boolean> => {
    if (!form.name.trim()) return false;
    setBusy(true);
    let credRef: string | undefined;
    if (form.password && window.fireeyeaud) {
      credRef = (await window.fireeyeaud.putSecret(form.password)) ?? undefined;
    }
    const payload = {
      name: form.name.trim(),
      driver: form.driver,
      scope: entity ? entity.scope : form.scope,
      path: isFile ? form.path.trim() || null : null,
      host: isFile ? null : form.host.trim() || null,
      port: isFile || !form.port ? null : Number(form.port),
      database: isFile ? null : form.database.trim() || null,
      username: isFile ? null : form.username.trim() || null,
      ...(credRef ? { credRef } : {}),
      isDefault: form.isDefault,
    };
    const ok = entity ? await edit(entity.id, entity.scope, payload) : await create(payload);
    setBusy(false);
    return ok;
  };

  const { modal, forceLeave } = useUnsavedGuard(dirty, save, entity?.name);

  const close = (cb: () => void) => {
    forceLeave();
    cb();
  };

  return (
    <div className="formtab__form">
      <label className="field">
        <span className="field__label">{t('name')}</span>
        <input
          className="searchbox"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('driver')}</span>
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
      </label>
      {isFile ? (
        <div className="field">
          <span className="field__label">{t('path')}</span>
          <div className="kv-row">
            <input
              className="searchbox"
              value={form.path}
              onChange={(e) => setForm({ ...form, path: e.target.value })}
            />
            <button
              type="button"
              className="button button--sm"
              onClick={() => void chooseFile()}
            >
              <FolderOpen size={12} strokeWidth={2} /> {tc('upload')}
            </button>
          </div>
          <span className="card__meta">{t('uploadHint')}</span>
          {localError && <span className="panel-error">{localError}</span>}
        </div>
      ) : (
        <>
          <label className="field">
            <span className="field__label">{t('host')}</span>
            <input
              className="searchbox"
              value={form.host}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field__label">{t('port')}</span>
            <input
              className="searchbox"
              value={form.port}
              onChange={(e) => setForm({ ...form, port: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field__label">{t('database')}</span>
            <input
              className="searchbox"
              value={form.database}
              onChange={(e) => setForm({ ...form, database: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field__label">{t('username')}</span>
            <input
              className="searchbox"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field__label">{t('password')}</span>
            <input
              className="searchbox"
              type="password"
              placeholder={entity ? t('passwordKeep') : ''}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
        </>
      )}
      <div className="field">
        <span className="field__label">{t('scope')}</span>
        <div className="search-opts">
          <label className="search-opt">
            <input
              type="radio"
              checked={form.scope === 'global'}
              disabled={Boolean(entity)}
              onChange={() => setForm({ ...form, scope: 'global' })}
            />
            <span>{te('configScope.global')}</span>
          </label>
          <label className="search-opt">
            <input
              type="radio"
              checked={form.scope === 'project'}
              disabled={Boolean(entity)}
              onChange={() => setForm({ ...form, scope: 'project' })}
            />
            <span>{te('configScope.project')}</span>
          </label>
          <label className="search-opt">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />
            <span>{t('isDefault')}</span>
          </label>
        </div>
      </div>

      <div className="form-test">
        <button
          type="button"
          className="button button--sm button--ghost"
          disabled={isFile ? !form.path.trim() : !form.host.trim() || !form.database.trim()}
          onClick={() => void runTest()}
        >
          <Zap size={13} strokeWidth={1.9} /> {t('test')}
        </button>
        {testStatus === 'ok' && (
          <span className="model-status model-status--ok">{t('testOk')}</span>
        )}
        {testStatus === 'fail' && (
          <span className="model-status model-status--fail">{t('testFail')}</span>
        )}
      </div>

      <span className="card__meta">{t('sqliteHint')}</span>

      {entity && (
        <div className="db-tables">
          <div className="card__row">
            <span className="field__label">{t('tables')}</span>
            <span className="spacer" />
            <button
              type="button"
              className="button button--sm"
              onClick={() => void reflect(entity.id, entity.scope)}
            >
              {t('reflect')}
            </button>
          </div>
          {tables && (
            <>
              {tables.length === 0 && (
                <span className="card__meta">{tc('notConfigured')}</span>
              )}
              {tables.map((tb) => {
                const cols = draft[tb.table];
                const checked = cols !== undefined;
                const allCols = cols?.includes('*') ?? false;
                const colOpen = openCols[tb.table];
                return (
                  <div key={tb.table} className="db-table">
                    <div className="card__row">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTable(tb.table)}
                      />
                      <span style={{ fontSize: 12 }}>{tb.table}</span>
                      {checked && (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() =>
                            setOpenCols((prev) => ({
                              ...prev,
                              [tb.table]: !prev[tb.table],
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
                        {allCols && <span className="card__meta">{t('selectAll')}</span>}
                        {tb.columns.map((c) => (
                          <label key={c.name} className="db-col">
                            <input
                              type="checkbox"
                              checked={allCols || (cols ?? []).includes(c.name)}
                              disabled={allCols}
                              onChange={() => toggleColumn(tb.table, c.name)}
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
                    entity.id,
                    Object.fromEntries(
                      Object.entries(draft).filter(([, v]) => v.length > 0),
                    ),
                  )
                }
              >
                {t('saveAuth')}
              </button>
            </>
          )}
        </div>
      )}

      <FormError errorKey={errorKey} />
      <FormActions
        onSave={() => void save().then((ok) => ok && close(onSaved))}
        onCancel={() => close(onCancel)}
        busy={busy}
        create={!entity}
        disabled={!form.name.trim() || (isFile ? !form.path.trim() : false)}
      />
      {modal}
    </div>
  );
}
