import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditRule } from '@fireeyeaud/shared';
import { useRulesStore } from '../../store/rules';
import { useDatabaseStore } from '../../store/database';
import { FormActions } from './FormActions';
import { FormError } from './FormError';
import { useUnsavedGuard } from './UnsavedGuard';

interface FormState {
  name: string;
  description: string;
  sql: string;
  databaseId: string;
  enabled: boolean;
}

const EMPTY: FormState = {
  name: '',
  description: '',
  sql: '',
  databaseId: '',
  enabled: true,
};

function init(entity?: AuditRule): FormState {
  if (!entity) return EMPTY;
  return {
    name: entity.name ?? '',
    description: entity.description ?? '',
    sql: entity.sql ?? '',
    databaseId: entity.databaseId ?? '',
    enabled: entity.enabled,
  };
}

export function RuleForm({
  entity,
  onSaved,
  onCancel,
}: {
  entity?: AuditRule;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('rules');
  const add = useRulesStore((s) => s.add);
  const edit = useRulesStore((s) => s.edit);
  const errorKey = useRulesStore((s) => s.errorKey);
  const connections = useDatabaseStore((s) => s.items);
  const loadConnections = useDatabaseStore((s) => s.load);

  const initialRef = useRef<FormState>(init(entity));
  const [form, setForm] = useState<FormState>(initialRef.current);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initialRef.current);

  const save = async (): Promise<boolean> => {
    if (!form.name.trim() || !form.sql.trim()) return false;
    setBusy(true);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      sql: form.sql,
      databaseId: form.databaseId || null,
      enabled: form.enabled,
    };
    const ok = entity ? await edit(entity.id, payload) : await add(payload);
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
        <span className="field__label">{t('description')}</span>
        <textarea
          className="searchbox"
          rows={2}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('sql')}</span>
        <textarea
          className="searchbox"
          rows={6}
          value={form.sql}
          onChange={(e) => setForm({ ...form, sql: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('defaultDatabase')}</span>
        <select
          className="searchbox"
          value={form.databaseId}
          onChange={(e) => setForm({ ...form, databaseId: e.target.value })}
        >
          <option value="">{t('workspace')}</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field field--inline">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        <span>{t('enabled')}</span>
      </label>

      <FormError errorKey={errorKey} />
      <FormActions
        onSave={() => void save().then((ok) => ok && close(onSaved))}
        onCancel={() => close(onCancel)}
        busy={busy}
        create={!entity}
        disabled={!form.name.trim() || !form.sql.trim()}
      />
      {modal}
    </div>
  );
}
