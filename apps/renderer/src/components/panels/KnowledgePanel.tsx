import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Info, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ConfigScope, KbEnabledEntry } from '@fireeyeaud/shared';
import { ScopeBadge } from '../ScopeBadge';
import { useKnowledgeStore } from '../../store/knowledge';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';

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
  const remove = useKnowledgeStore((s) => s.remove);
  const test = useKnowledgeStore((s) => s.test);
  const loadKnowledge = useKnowledgeStore((s) => s.loadKnowledge);
  const setEnabled = useKnowledgeStore((s) => s.setEnabled);
  const openForm = useUiStore((s) => s.openForm);
  const path = useWorkspaceStore((s) => s.path);

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
        onClick={() => void openForm('knowledge', 'create')}
      >
        <Plus size={12} strokeWidth={2} /> {t('newConnection')}
      </button>

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
                  className="icon-btn"
                  title={tc('edit')}
                  onClick={() =>
                    void openForm('knowledge', 'edit', {
                      id: provider.id,
                      scope: provider.scope,
                      name: provider.name,
                    })
                  }
                >
                  <Pencil size={13} strokeWidth={1.75} />
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
