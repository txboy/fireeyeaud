import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Info, Plus, Trash2 } from 'lucide-react';
import type { ConfigScope, KbEnabledEntry, KbProviderType } from '@fireeyeaud/shared';
import { ScopeBadge } from '../ScopeBadge';
import { useKnowledgeStore } from '../../store/knowledge';
import { useWorkspaceStore } from '../../store/workspace';

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

const EMPTY_FORM: FormState = {
  type: 'dify',
  name: '',
  baseUrl: '',
  apiKey: '',
  scope: 'project',
  topK: '',
  scoreThreshold: '',
};

export function KnowledgePanel() {
  const { t } = useTranslation('knowledge');
  const { t: te } = useTranslation('enums');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');

  const items = useKnowledgeStore((s) => s.items);
  const loading = useKnowledgeStore((s) => s.loading);
  const errorKey = useKnowledgeStore((s) => s.errorKey);
  const knowledgeByProvider = useKnowledgeStore((s) => s.knowledgeByProvider);
  const enabled = useKnowledgeStore((s) => s.enabled);
  const load = useKnowledgeStore((s) => s.load);
  const create = useKnowledgeStore((s) => s.create);
  const remove = useKnowledgeStore((s) => s.remove);
  const test = useKnowledgeStore((s) => s.test);
  const loadKnowledge = useKnowledgeStore((s) => s.loadKnowledge);
  const setEnabled = useKnowledgeStore((s) => s.setEnabled);
  const path = useWorkspaceStore((s) => s.path);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [testOk, setTestOk] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (path) void load();
  }, [load, path]);

  const enabledMap = useMemo(
    () =>
      Object.fromEntries(
        enabled.map((e) => [`${e.providerId}:${e.knowledgeId}`, e.enabled]),
      ),
    [enabled],
  );

  const isOn = (providerId: string, knowledgeId: string) =>
    draft[`${providerId}:${knowledgeId}`] ?? enabledMap[`${providerId}:${knowledgeId}`] ?? false;

  const toggle = (providerId: string, knowledgeId: string) =>
    setDraft((d) => ({
      ...d,
      [`${providerId}:${knowledgeId}`]: !isOn(providerId, knowledgeId),
    }));

  const submit = async () => {
    if (!form.name.trim() || !form.baseUrl.trim()) return;
    setBusy(true);
    let apiKeyRef: string | undefined;
    if (form.apiKey && window.fireeyeaud?.putSecret) {
      apiKeyRef = (await window.fireeyeaud.putSecret(form.apiKey)) ?? undefined;
    }
    const defaults: Record<string, unknown> = {};
    if (form.topK.trim()) defaults.topK = Number(form.topK);
    if (form.scoreThreshold.trim()) defaults.scoreThreshold = Number(form.scoreThreshold);
    const ok = await create({
      type: form.type,
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      scope: form.scope,
      apiKeyRef,
      defaults: Object.keys(defaults).length ? defaults : undefined,
    });
    setBusy(false);
    if (ok) {
      setShowForm(false);
      setForm(EMPTY_FORM);
    }
  };

  const saveEnabled = async (providerId: string, scope: ConfigScope) => {
    const base = new Map<string, KbEnabledEntry>(
      enabled
        .filter((e) => e.scope === scope)
        .map((e) => [`${e.providerId}:${e.knowledgeId}`, { ...e }]),
    );
    for (const k of knowledgeByProvider[providerId] ?? []) {
      const key = `${providerId}:${k.id}`;
      base.set(key, {
        providerId,
        knowledgeId: k.id,
        name: k.name,
        scope,
        enabled: isOn(providerId, k.id),
      });
    }
    await setEnabled(scope, [...base.values()]);
    setDraft({});
  };

  if (!path) {
    return (
      <div className="panel-empty">
        <span>{tc('noWorkspace')}</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="button button--sm"
        onClick={() => setShowForm((v) => !v)}
      >
        <Plus size={12} strokeWidth={2} /> {t('newConnection')}
      </button>

      {showForm && (
        <div className="card db-form">
          <input
            className="searchbox"
            placeholder={t('name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <select
            className="searchbox"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as KbProviderType })}
          >
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {te(`kbProvider.${ty}`)}
              </option>
            ))}
          </select>
          <input
            className="searchbox"
            placeholder={t('baseUrl')}
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          />
          <input
            className="searchbox"
            type="password"
            placeholder={t('apiKey')}
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          />
          <div className="card__row">
            <input
              className="searchbox"
              placeholder={t('topK')}
              value={form.topK}
              onChange={(e) => setForm({ ...form, topK: e.target.value })}
            />
            <input
              className="searchbox"
              placeholder={t('scoreThreshold')}
              value={form.scoreThreshold}
              onChange={(e) => setForm({ ...form, scoreThreshold: e.target.value })}
            />
          </div>
          <div className="card__row">
            <select
              className="searchbox"
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as ConfigScope })}
            >
              <option value="project">{te('configScope.project')}</option>
              <option value="global">{te('configScope.global')}</option>
            </select>
            <span className="spacer" />
            <button
              type="button"
              className="button button--sm"
              disabled={busy || !form.name.trim() || !form.baseUrl.trim()}
              onClick={() => void submit()}
            >
              {t('save')}
            </button>
            <button
              type="button"
              className="button button--sm button--ghost"
              onClick={() => setShowForm(false)}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {errorKey && (
        <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
      )}

      {loading && items.length === 0 ? (
        <div className="panel-empty">
          <span>{tc('loading')}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="panel-empty">
          <span>{t('empty')}</span>
        </div>
      ) : (
        items.map((provider) => {
          const remote = knowledgeByProvider[provider.id];
          return (
            <div key={provider.id} className="card">
              <div className="card__row">
                <span
                  className="status-dot"
                  style={{
                    background:
                      testOk[provider.id] === true
                        ? 'var(--success)'
                        : testOk[provider.id] === false
                          ? 'var(--danger, #d9480f)'
                          : 'var(--text-3)',
                  }}
                />
                <span className="card__name">{provider.name}</span>
                <span className="scope-badge">{te(`kbProvider.${provider.type}`)}</span>
                <ScopeBadge scope={provider.scope} />
                <span className="spacer" />
                <button
                  type="button"
                  className="button button--sm"
                  onClick={() =>
                    void test(provider.id, provider.scope).then((ok) =>
                      setTestOk((prev) => ({ ...prev, [provider.id]: ok })),
                    )
                  }
                >
                  {t('test')}
                </button>
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  onClick={() => void loadKnowledge(provider.id, provider.scope)}
                >
                  <BookOpen size={12} strokeWidth={2} /> {t('browse')}
                </button>
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  onClick={() => void remove(provider.id, provider.scope)}
                >
                  <Trash2 size={12} strokeWidth={2} />
                </button>
              </div>
              <span className="card__meta">{provider.baseUrl}</span>
              {testOk[provider.id] === true && (
                <span className="card__meta">{t('testOk', { count: remote?.length ?? 0 })}</span>
              )}

              {remote && (
                <div className="db-tables">
                  <div className="card__meta">{t('remoteKb')}</div>
                  {remote.length === 0 && (
                    <span className="card__meta">{tc('notConfigured')}</span>
                  )}
                  {remote.map((kb) => (
                    <label key={kb.id} className="db-col">
                      <input
                        type="checkbox"
                        checked={isOn(provider.id, kb.id)}
                        onChange={() => toggle(provider.id, kb.id)}
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
                    onClick={() => void saveEnabled(provider.id, provider.scope)}
                  >
                    {t('save')}
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      <div className="note">
        <Info size={14} strokeWidth={1.75} />
        <span>{t('egress')}</span>
      </div>
    </>
  );
}
