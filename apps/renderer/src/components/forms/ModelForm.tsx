import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConfigScope, ModelProfile } from '@fireeyeaud/shared';
import { useModelsStore } from '../../store/models';
import { FormActions } from './FormActions';
import { FormError } from './FormError';
import { useUnsavedGuard } from './UnsavedGuard';

interface FormState {
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  temperature: string;
  isDefault: boolean;
  scope: ConfigScope;
}

const EMPTY: FormState = {
  name: '',
  provider: 'openai',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen2.5',
  temperature: '0.2',
  isDefault: false,
  scope: 'global',
};

function init(entity?: ModelProfile): FormState {
  if (!entity) return EMPTY;
  return {
    name: entity.name,
    provider: entity.provider,
    baseUrl: entity.baseUrl,
    model: entity.model,
    temperature: String(entity.temperature ?? 0.2),
    isDefault: Boolean(entity.isDefault),
    scope: entity.scope,
  };
}

export function ModelForm({
  entity,
  onSaved,
  onCancel,
}: {
  entity?: ModelProfile;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('models');
  const { t: ten } = useTranslation('enums');
  const add = useModelsStore((s) => s.add);
  const edit = useModelsStore((s) => s.edit);
  const errorKey = useModelsStore((s) => s.errorKey);

  const initialRef = useRef<FormState>(init(entity));
  const [form, setForm] = useState<FormState>(initialRef.current);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(initialRef.current);

  const save = async (): Promise<boolean> => {
    const payload = {
      name: form.name.trim(),
      provider: form.provider.trim(),
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      temperature: Number(form.temperature) || 0.2,
      isDefault: form.isDefault,
      scope: form.scope,
    };
    if (!payload.name || !payload.baseUrl || !payload.model) return false;
    setBusy(true);
    setLocalError(null);
    try {
      if (entity) await edit(entity.id, entity.scope, payload);
      else await add(payload);
      return true;
    } catch (err) {
      setLocalError((err as { messageKey?: string }).messageKey ?? 'error.internal');
      return false;
    } finally {
      setBusy(false);
    }
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
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('provider')}</span>
        <input
          className="searchbox"
          value={form.provider}
          onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('baseUrl')}</span>
        <input
          className="searchbox"
          value={form.baseUrl}
          onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('modelName')}</span>
        <input
          className="searchbox"
          value={form.model}
          onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('temperature')}</span>
        <input
          className="searchbox"
          type="number"
          value={form.temperature}
          onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))}
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
              onChange={() => setForm((f) => ({ ...f, scope: 'global' }))}
            />
            <span>{ten('configScope.global')}</span>
          </label>
          <label className="search-opt">
            <input
              type="radio"
              checked={form.scope === 'project'}
              disabled={Boolean(entity)}
              onChange={() => setForm((f) => ({ ...f, scope: 'project' }))}
            />
            <span>{ten('configScope.project')}</span>
          </label>
          <label className="search-opt">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
            />
            <span>{t('isDefault')}</span>
          </label>
        </div>
      </div>

      <FormError errorKey={localError ?? errorKey} />
      <FormActions
        onSave={() => void save().then((ok) => ok && close(onSaved))}
        onCancel={() => close(onCancel)}
        busy={busy}
        disabled={!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()}
      />
      {modal}
    </div>
  );
}
