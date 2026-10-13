import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { ScopeBadge } from '../ScopeBadge';
import { useDatabaseStore } from '../../store/database';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';

export function DatabasePanel() {
  const { t } = useTranslation('database');
  const { t: te } = useTranslation('enums');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');

  const items = useDatabaseStore((s) => s.items);
  const loading = useDatabaseStore((s) => s.loading);
  const errorKey = useDatabaseStore((s) => s.errorKey);
  const load = useDatabaseStore((s) => s.load);
  const remove = useDatabaseStore((s) => s.remove);
  const test = useDatabaseStore((s) => s.test);
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
        onClick={() => void openForm('database', 'create')}
      >
        <Plus size={12} strokeWidth={2} /> {t('addConnection')}
      </button>

      {errorKey && (
        <div className="panel-error">
          {terr(errorKey.replace(/^error\./, ''))}
        </div>
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
        items.map((conn) => (
          <div key={conn.id} className="card">
            <div className="card__head">
              <span
                className="status-dot"
                style={{
                  background:
                    testOk[conn.id] === true
                      ? 'var(--success)'
                      : testOk[conn.id] === false
                        ? 'var(--danger, #d9480f)'
                        : 'var(--text-3)',
                }}
              />
              <span className="card__name">{conn.name}</span>
              <span className="scope-badge">{te(`driver.${conn.driver}`)}</span>
              <span className="spacer" />
              <ScopeBadge scope={conn.scope} />
            </div>
            {conn.path ? <span className="card__meta">{conn.path}</span> : null}
            {testOk[conn.id] === true && (
              <span className="card__meta">{t('testOk')}</span>
            )}
            <div className="card__foot">
              <span className="spacer" />
              <button
                type="button"
                className="icon-btn"
                title={t('test')}
                onClick={() =>
                  void test(conn.id, conn.scope).then((ok) =>
                    setTestOk((prev) => ({ ...prev, [conn.id]: ok })),
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
                  void openForm('database', 'edit', {
                    id: conn.id,
                    scope: conn.scope,
                    name: conn.name,
                  })
                }
              >
                <Pencil size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={tc('delete')}
                onClick={() => void remove(conn.id, conn.scope)}
              >
                <Trash2 size={13} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
