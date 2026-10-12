import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConfigScope, DbConnection, DbDriver } from '@fireeyeaud/shared';
import { useDatabaseStore } from '../../store/database';
import { FormActions } from './FormActions';
import { FormError } from './FormError';
import { useUnsavedGuard } from './UnsavedGuard';

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
  const create = useDatabaseStore((s) => s.create);
  const edit = useDatabaseStore((s) => s.edit);
  const errorKey = useDatabaseStore((s) => s.errorKey);

  const initialRef = useRef<FormState>(init(entity));
  const [form, setForm] = useState<FormState>(initialRef.current);
  const [busy, setBusy] = useState(false);

  const isFile = form.driver === 'sqlite' || form.driver === 'access';
  const dirty = JSON.stringify(form) !== JSON.stringify(initialRef.current);

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
        <label className="field">
          <span className="field__label">{t('path')}</span>
          <input
            className="searchbox"
            value={form.path}
            onChange={(e) => setForm({ ...form, path: e.target.value })}
          />
        </label>
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
      <label className="field">
        <span className="field__label">{t('scope')}</span>
        <select
          className="searchbox"
          value={form.scope}
          disabled={Boolean(entity)}
          onChange={(e) => setForm({ ...form, scope: e.target.value as ConfigScope })}
        >
          <option value="project">{te('configScope.project')}</option>
          <option value="global">{te('configScope.global')}</option>
        </select>
      </label>
      <label className="field field--inline">
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
        />
        <span>{t('isDefault')}</span>
      </label>

      <span className="card__meta">{t('sqliteHint')}</span>
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
