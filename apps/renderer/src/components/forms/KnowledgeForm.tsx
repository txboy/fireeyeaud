import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConfigScope, KbProvider, KbProviderType } from '@fireeyeaud/shared';
import { useKnowledgeStore } from '../../store/knowledge';
import { FormActions } from './FormActions';
import { FormError } from './FormError';
import { useUnsavedGuard } from './UnsavedGuard';

const TYPES: KbProviderType[] = ['dify', 'ragflow'];

interface FormState {
  type: KbProviderType;
  name: string;
  baseUrl: string;
  apiKey: string;
  scope: ConfigScope;
  topK: string;
  scoreThreshold: string;
}

const EMPTY: FormState = {
  type: 'dify',
  name: '',
  baseUrl: '',
  apiKey: '',
  scope: 'project',
  topK: '',
  scoreThreshold: '',
};

function init(entity?: KbProvider): FormState {
  if (!entity) return EMPTY;
  return {
    type: entity.type,
    name: entity.name,
    baseUrl: entity.baseUrl,
    // 密钥只写不读：编辑时不回填，留空表示保持原密钥。
    apiKey: '',
    scope: entity.scope,
    topK: entity.defaults?.topK != null ? String(entity.defaults.topK) : '',
    scoreThreshold:
      entity.defaults?.scoreThreshold != null ? String(entity.defaults.scoreThreshold) : '',
  };
}

export function KnowledgeForm({
  entity,
  onSaved,
  onCancel,
}: {
  entity?: KbProvider;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('knowledge');
  const { t: te } = useTranslation('enums');
  const create = useKnowledgeStore((s) => s.create);
  const edit = useKnowledgeStore((s) => s.edit);
  const errorKey = useKnowledgeStore((s) => s.errorKey);

  const initialRef = useRef<FormState>(init(entity));
  const [form, setForm] = useState<FormState>(initialRef.current);
  const [busy, setBusy] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(initialRef.current);

  const save = async (): Promise<boolean> => {
    if (!form.name.trim() || !form.baseUrl.trim()) return false;
    setBusy(true);
    try {
      let apiKeyRef: string | undefined;
      if (form.apiKey && window.fireeyeaud) {
        apiKeyRef = (await window.fireeyeaud.putSecret(form.apiKey)) ?? undefined;
      }
      const defaults: Record<string, unknown> = {};
      if (form.topK.trim()) defaults.topK = Number(form.topK);
      if (form.scoreThreshold.trim()) defaults.scoreThreshold = Number(form.scoreThreshold);
      const common = {
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        apiKeyRef,
        defaults: Object.keys(defaults).length ? defaults : undefined,
      };
      return entity
        ? await edit(entity.id, entity.scope, common)
        : await create({ ...common, type: form.type, scope: form.scope });
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
        <span className="field__label">{t('providerType')}</span>
        <select
          className="searchbox"
          value={form.type}
          disabled={Boolean(entity)}
          onChange={(e) => setForm({ ...form, type: e.target.value as KbProviderType })}
        >
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {te(`kbProvider.${ty}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">{t('name')}</span>
        <input
          className="searchbox"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('baseUrl')}</span>
        <input
          className="searchbox"
          value={form.baseUrl}
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('apiKey')}</span>
        <input
          className="searchbox"
          type="password"
          placeholder={entity ? t('apiKeyKeep') : ''}
          value={form.apiKey}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('topK')}</span>
        <input
          className="searchbox"
          value={form.topK}
          onChange={(e) => setForm({ ...form, topK: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('scoreThreshold')}</span>
        <input
          className="searchbox"
          value={form.scoreThreshold}
          onChange={(e) => setForm({ ...form, scoreThreshold: e.target.value })}
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

      <span className="card__meta">{t('egress')}</span>
      <FormError errorKey={errorKey} />
      <FormActions
        onSave={() => void save().then((ok) => ok && close(onSaved))}
        onCancel={() => close(onCancel)}
        busy={busy}
        create={!entity}
        disabled={!form.name.trim() || !form.baseUrl.trim()}
      />
      {modal}
    </div>
  );
}
