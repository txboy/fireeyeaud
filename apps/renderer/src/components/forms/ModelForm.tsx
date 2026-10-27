import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import type { ConfigScope, ModelProfile } from '@fireeyeaud/shared';
import { useModelsStore } from '../../store/models';
import { FormActions } from './FormActions';
import { FormError } from './FormError';
import { useUnsavedGuard } from './UnsavedGuard';
import { errorKeyOf } from '../../lib/errorKey';

interface FormState {
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  temperature: string;
  apiKey: string;
  isDefault: boolean;
  vision: boolean;
  scope: ConfigScope;
}

const EMPTY: FormState = {
  name: '',
  provider: 'openai',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen2.5',
  temperature: '0.2',
  apiKey: '',
  isDefault: false,
  vision: false,
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
    // 密钥只写不读：编辑时不回填，留空表示保持原密钥。
    apiKey: '',
    isDefault: Boolean(entity.isDefault),
    vision: Boolean(entity.vision),
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
  const { t: tc } = useTranslation('common');
  const add = useModelsStore((s) => s.add);
  const edit = useModelsStore((s) => s.edit);
  const testParams = useModelsStore((s) => s.testParams);
  const errorKey = useModelsStore((s) => s.errorKey);

  const initialRef = useRef<FormState>(init(entity));
  const [form, setForm] = useState<FormState>(initialRef.current);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'ok' | 'fail' | null>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(initialRef.current);

  const runTest = async () => {
    const ok = await testParams({
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
    });
    setTestStatus(ok ? 'ok' : 'fail');
  };

  const save = async (): Promise<boolean> => {
    if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()) return false;
    setBusy(true);
    setLocalError(null);
    try {
      let apiKeyRef: string | undefined;
      if (form.apiKey && window.fireeyeaud) {
        apiKeyRef = (await window.fireeyeaud.putSecret(form.apiKey)) ?? undefined;
      }
      const payload = {
        name: form.name.trim(),
        provider: form.provider.trim(),
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        temperature: Number(form.temperature) || 0.2,
        apiKeyRef,
        isDefault: form.isDefault,
        vision: form.vision,
        scope: form.scope,
      };
      if (entity) await edit(entity.id, entity.scope, payload);
      else await add(payload);
      return true;
    } catch (err) {
      setLocalError(errorKeyOf(err));
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
        <span className="field__label">{t('apiKey')}</span>
        <input
          className="searchbox"
          type="password"
          placeholder={entity ? t('apiKeyKeep') : ''}
          value={form.apiKey}
          onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
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
          <label className="search-opt">
            <input
              type="checkbox"
              checked={form.vision}
              onChange={(e) => setForm((f) => ({ ...f, vision: e.target.checked }))}
            />
            <span>{t('vision')}</span>
          </label>
        </div>
      </div>

      <div className="form-test">
        <button
          type="button"
          className="button button--sm button--ghost"
          disabled={!form.baseUrl.trim() || !form.model.trim()}
          onClick={() => void runTest()}
        >
          <Zap size={13} strokeWidth={1.9} /> {tc('test')}
        </button>
        {testStatus === 'ok' && <span className="model-status model-status--ok">{t('testOk')}</span>}
        {testStatus === 'fail' && (
          <span className="model-status model-status--fail">{t('testFail')}</span>
        )}
      </div>

      <FormError errorKey={localError ?? errorKey} />
      <FormActions
        onSave={() => void save().then((ok) => ok && close(onSaved))}
        onCancel={() => close(onCancel)}
        busy={busy}
        create={!entity}
        disabled={!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()}
      />
      {modal}
    </div>
  );
}
