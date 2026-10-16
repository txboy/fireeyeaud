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
  description: string;
  whenToUse: string;
  eager: boolean;
  toolIds: string;
  scope: ConfigScope;
  isDefault: boolean;
  enabled: boolean;
}

const EMPTY: FormState = {
  name: '',
  prompt: '',
  description: '',
  whenToUse: '',
  eager: false,
  toolIds: '',
  scope: 'project',
  isDefault: false,
  enabled: true,
};

function init(entity?: Skill): FormState {
  if (!entity) return EMPTY;
  return {
    name: entity.name,
    prompt: entity.prompt,
    description: entity.description ?? '',
    whenToUse: entity.whenToUse ?? '',
    eager: Boolean(entity.eager),
    toolIds: (entity.toolIds ?? []).join(' '),
    scope: entity.scope,
    isDefault: Boolean(entity.isDefault),
    enabled: entity.enabled,
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
      // 空字符串表示「清空该字段」（undefined 会被 JSON 丢弃、null 会被 store 的
      // drop_none 忽略，二者都无法清除已有值）。
      description: form.description.trim(),
      whenToUse: form.whenToUse.trim(),
      eager: form.eager,
      toolIds: parseTokens(form.toolIds),
      scope: form.scope,
      isDefault: form.isDefault,
      enabled: form.enabled,
    };
    const ok = entity
      ? await edit(entity.id, form.scope, payload)
      : await create({ ...payload, enabled: form.enabled });
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
        <span className="field__label">{t('description')}</span>
        <input
          className="searchbox"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('whenToUse')}</span>
        <input
          className="searchbox"
          value={form.whenToUse}
          onChange={(e) => setForm({ ...form, whenToUse: e.target.value })}
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

      <label className="field field--inline">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        <span>{t('enabled')}</span>
      </label>

      <label className="field field--inline">
        <input
          type="checkbox"
          checked={form.eager}
          onChange={(e) => setForm({ ...form, eager: e.target.checked })}
        />
        <span>{t('eager')}</span>
      </label>

      <FormError errorKey={errorKey} />
      <FormActions
        onSave={() => void save().then((ok) => ok && close(onSaved))}
        onCancel={() => close(onCancel)}
        busy={busy}
        create={!entity}
        disabled={!form.name.trim() || !form.prompt.trim()}
      />
      {modal}
    </div>
  );
}
