import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConfigScope, Skill } from '@fireeyeaud/shared';
import { useSkillsStore } from '../../store/skills';
import { FormActions } from './FormActions';
import { FormError } from './FormError';
import { useUnsavedGuard } from './UnsavedGuard';

interface FormState {
  name: string;
  prompt: string;
  toolIds: string;
  scope: ConfigScope;
}

const EMPTY: FormState = { name: '', prompt: '', toolIds: '', scope: 'project' };

function init(entity?: Skill): FormState {
  if (!entity) return EMPTY;
  return {
    name: entity.name,
    prompt: entity.prompt,
    toolIds: (entity.toolIds ?? []).join(' '),
    scope: entity.scope === 'builtin' ? 'project' : entity.scope,
  };
}

function parseTokens(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function SkillForm({
  entity,
  onSaved,
  onCancel,
}: {
  entity?: Skill;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('skills');
  const { t: te } = useTranslation('enums');
  const create = useSkillsStore((s) => s.create);
  const edit = useSkillsStore((s) => s.edit);
  const errorKey = useSkillsStore((s) => s.errorKey);

  const initialRef = useRef<FormState>(init(entity));
  const [form, setForm] = useState<FormState>(initialRef.current);
  const [busy, setBusy] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(initialRef.current);

  const save = async (): Promise<boolean> => {
    if (!form.name.trim() || !form.prompt.trim()) return false;
    setBusy(true);
    const payload = {
      name: form.name.trim(),
      prompt: form.prompt.trim(),
      toolIds: parseTokens(form.toolIds),
      scope: form.scope,
    };
    const ok = entity
      ? await edit(entity.id, form.scope, payload)
      : await create({ ...payload, enabled: true });
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
        <span className="field__label">{t('prompt')}</span>
        <textarea
          className="searchbox"
          rows={4}
          value={form.prompt}
          onChange={(e) => setForm({ ...form, prompt: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('tools')}</span>
        <input
          className="searchbox"
          value={form.toolIds}
          onChange={(e) => setForm({ ...form, toolIds: e.target.value })}
        />
      </label>
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

      <FormError errorKey={errorKey} />
      <FormActions
        onSave={() => void save().then((ok) => ok && close(onSaved))}
        onCancel={() => close(onCancel)}
        busy={busy}
        disabled={!form.name.trim() || !form.prompt.trim()}
      />
      {modal}
    </div>
  );
}
