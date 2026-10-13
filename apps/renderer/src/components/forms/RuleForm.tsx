import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditRule } from '@fireeyeaud/shared';
import { useRulesStore } from '../../store/rules';
import { ruleName } from '../../lib/rules';
import { FormActions } from './FormActions';
import { FormError } from './FormError';
import { useUnsavedGuard } from './UnsavedGuard';

interface FormState {
  name: string;
  type: 'sql' | 'prompt';
  definition: string;
  severity: string;
  enabled: boolean;
}

const EMPTY: FormState = {
  name: '',
  type: 'sql',
  definition: '',
  severity: 'medium',
  enabled: true,
};

function init(entity?: AuditRule): FormState {
  if (!entity) return EMPTY;
  return {
    name: ruleName(entity),
    type: entity.type,
    definition: entity.definition ?? '',
    severity: entity.severity,
    enabled: entity.enabled,
  };
}

const SEVERITIES = ['high', 'medium', 'low'] as const;

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
  const { t: te } = useTranslation('enums');
  const add = useRulesStore((s) => s.add);
  const edit = useRulesStore((s) => s.edit);
  const errorKey = useRulesStore((s) => s.errorKey);

  const initialRef = useRef<FormState>(init(entity));
  const [form, setForm] = useState<FormState>(initialRef.current);
  const [busy, setBusy] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(initialRef.current);

  const save = async (): Promise<boolean> => {
    if (!form.name.trim()) return false;
    setBusy(true);
    const payload = {
      name: form.name.trim(),
      type: form.type,
      definition: form.definition,
      severity: form.severity,
      enabled: form.enabled,
    };
    const ok = entity ? await edit(entity.id, payload) : await add(payload);
    setBusy(false);
    return ok;
  };

  const { modal, forceLeave } = useUnsavedGuard(dirty, save, entity ? ruleName(entity) : undefined);

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
        <span className="field__label">{t('type')}</span>
        <select
          className="searchbox"
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value as 'sql' | 'prompt' })}
        >
          <option value="sql">{t('typeSql')}</option>
          <option value="prompt">{t('typePrompt')}</option>
        </select>
      </label>
      <label className="field">
        <span className="field__label">{t('definition')}</span>
        <textarea
          className="searchbox"
          rows={6}
          value={form.definition}
          onChange={(e) => setForm({ ...form, definition: e.target.value })}
        />
      </label>
      <div className="field">
        <span className="field__label">{t('severity')}</span>
        <select
          className="searchbox"
          value={form.severity}
          onChange={(e) => setForm({ ...form, severity: e.target.value })}
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {te(`severity.${s}`)}
            </option>
          ))}
        </select>
      </div>
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
        disabled={!form.name.trim()}
      />
      {modal}
    </div>
  );
}
