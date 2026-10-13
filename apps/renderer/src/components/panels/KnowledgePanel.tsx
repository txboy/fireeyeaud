import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Pencil, Plus, Trash2, Zap } from 'lucide-react';
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
  const load = useKnowledgeStore((s) => s.load);
  const remove = useKnowledgeStore((s) => s.remove);
  const test = useKnowledgeStore((s) => s.test);
  const openForm = useUiStore((s) => s.openForm);
  const path = useWorkspaceStore((s) => s.path);

  const [testOk, setTestOk] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (path) void load();
  }, [load, path]);

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
        items.map((provider) => (
          <div key={provider.id} className="card">
            <div className="card__head">
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
              <span className="spacer" />
              <ScopeBadge scope={provider.scope} />
            </div>
            <span className="card__meta">{provider.baseUrl}</span>
            {testOk[provider.id] === true && (
              <span className="card__meta">{tc('connected')}</span>
            )}
            <div className="card__foot">
              <span className="spacer" />
              <button
                type="button"
                className="icon-btn"
                title={t('test')}
                onClick={() =>
                  void test(provider.id, provider.scope).then((ok) =>
                    setTestOk((prev) => ({ ...prev, [provider.id]: ok })),
                  )
                }
              >
                <Zap size={13} strokeWidth={1.75} />
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
                className="icon-btn"
                title={tc('delete')}
                onClick={() => void remove(provider.id, provider.scope)}
              >
                <Trash2 size={13} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        ))
      )}

      <div className="note">
        <Info size={14} strokeWidth={1.75} />
        <span>{t('egress')}</span>
      </div>
    </>
  );
}
