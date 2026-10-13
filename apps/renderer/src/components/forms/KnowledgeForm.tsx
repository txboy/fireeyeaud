import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Zap } from 'lucide-react';
import type { ConfigScope, KbEnabledEntry, KbProvider, KbProviderType } from '@fireeyeaud/shared';
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
  isDefault: boolean;
}

const EMPTY: FormState = {
  type: 'dify',
  name: '',
  baseUrl: '',
  apiKey: '',
  scope: 'project',
  topK: '',
  scoreThreshold: '',
  isDefault: false,
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
    isDefault: Boolean(entity.isDefault),
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
  const { t: tc } = useTranslation('common');
  const create = useKnowledgeStore((s) => s.create);
  const edit = useKnowledgeStore((s) => s.edit);
  const testParams = useKnowledgeStore((s) => s.testParams);
  const errorKey = useKnowledgeStore((s) => s.errorKey);
  const knowledgeByProvider = useKnowledgeStore((s) => s.knowledgeByProvider);
  const enabled = useKnowledgeStore((s) => s.enabled);
  const loadKnowledge = useKnowledgeStore((s) => s.loadKnowledge);
  const setEnabled = useKnowledgeStore((s) => s.setEnabled);

  const initialRef = useRef<FormState>(init(entity));
  const [form, setForm] = useState<FormState>(initialRef.current);
  const [busy, setBusy] = useState(false);
  const [testStatus, setTestStatus] = useState<'ok' | 'fail' | null>(null);
  const [kbDraft, setKbDraft] = useState<Record<string, boolean>>({});

  const dirty = JSON.stringify(form) !== JSON.stringify(initialRef.current);

  const remote = entity ? knowledgeByProvider[entity.id] : undefined;

  const enabledMap = useMemo(
    () =>
      Object.fromEntries(
        enabled.map((e) => [`${e.providerId}:${e.knowledgeId}`, e.enabled]),
      ),
    [enabled],
  );

  const isOn = (knowledgeId: string) =>
    entity
      ? kbDraft[knowledgeId] ?? enabledMap[`${entity.id}:${knowledgeId}`] ?? false
      : false;

  const toggleKb = (knowledgeId: string) =>
    setKbDraft((d) => ({ ...d, [knowledgeId]: !isOn(knowledgeId) }));

  const saveEnabled = async () => {
    if (!entity) return;
    const base = new Map<string, KbEnabledEntry>(
      enabled
        .filter((e) => e.scope === entity.scope)
        .map((e) => [`${e.providerId}:${e.knowledgeId}`, { ...e }]),
    );
    for (const k of knowledgeByProvider[entity.id] ?? []) {
      base.set(`${entity.id}:${k.id}`, {
        providerId: entity.id,
        knowledgeId: k.id,
        name: k.name,
        scope: entity.scope,
        enabled: isOn(k.id),
      });
    }
    await setEnabled(entity.scope, [...base.values()]);
    setKbDraft({});
  };

  const runTest = async () => {
    const ok = await testParams({
      type: form.type,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey || null,
      id: entity?.id,
      scope: entity?.scope,
    });
    setTestStatus(ok ? 'ok' : 'fail');
  };

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
        isDefault: form.isDefault,
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
          disabled={!form.baseUrl.trim()}
          onClick={() => void runTest()}
        >
          <Zap size={13} strokeWidth={1.9} /> {t('test')}
        </button>
        {testStatus === 'ok' && (
          <span className="model-status model-status--ok">{tc('connected')}</span>
        )}
        {testStatus === 'fail' && (
          <span className="model-status model-status--fail">{t('testFail')}</span>
        )}
      </div>

      <span className="card__meta">{t('egress')}</span>

      {entity && (
        <div className="db-tables">
          <div className="card__row">
            <span className="field__label">{t('remoteKb')}</span>
            <span className="spacer" />
            <button
              type="button"
              className="button button--sm"
              onClick={() => void loadKnowledge(entity.id, entity.scope)}
            >
              <BookOpen size={12} strokeWidth={2} /> {t('browse')}
            </button>
          </div>
          {remote && (
            <>
              {remote.length === 0 && (
                <span className="card__meta">{tc('notConfigured')}</span>
              )}
              {remote.map((kb) => (
                <label key={kb.id} className="db-col">
                  <input
                    type="checkbox"
                    checked={isOn(kb.id)}
                    onChange={() => toggleKb(kb.id)}
                  />
                  <span>{kb.name}</span>
                  {kb.documentCount !== undefined && (
                    <span className="card__meta">
                      {t('documents', { count: kb.documentCount })}
                    </span>
                  )}
                </label>
              ))}
              <button
                type="button"
                className="button button--sm"
                disabled={remote.length === 0}
                onClick={() => void saveEnabled()}
              >
                {t('save')}
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
        disabled={!form.name.trim() || !form.baseUrl.trim()}
      />
      {modal}
    </div>
  );
}
