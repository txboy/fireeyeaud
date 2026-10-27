import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2, X, Zap, KeyRound, Database } from 'lucide-react';
import type { DbConnection } from '@fireeyeaud/shared';
import { ScopeBadge } from '../ScopeBadge';
import { useDatabaseStore } from '../../store/database';
import { useDatasourcesStore } from '../../store/datasources';
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
  const openDbSchema = useUiStore((s) => s.openDbSchema);
  const path = useWorkspaceStore((s) => s.path);
  // 项目数据还在后台准备（首次打开 / 文件很多）时，表结构尚未就绪，先别让用户误判为「表不存在」。
  const preparing = useDatasourcesStore((s) => Boolean(s.backgroundSync));

  const [status, setStatus] = useState<Record<string, 'ok' | 'fail'>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (path) void load();
  }, [load, path]);

  const runTest = async (conn: DbConnection) => {
    setTesting((s) => ({ ...s, [conn.id]: true }));
    try {
      const ok = await test(conn.id, conn.scope);
      setStatus((s) => ({ ...s, [conn.id]: ok ? 'ok' : 'fail' }));
    } finally {
      setTesting((s) => ({ ...s, [conn.id]: false }));
    }
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
        onClick={() => void openForm('database', 'create')}
      >
        <Plus size={12} strokeWidth={2} /> {t('addConnection')}
      </button>

      {preparing && (
        <div className="panel-hint panel-hint--progress" role="status">
          <Database size={12} strokeWidth={2} />
          <span>{t('dataPreparing')}</span>
        </div>
      )}

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
                    status[conn.id] === 'ok'
                      ? 'var(--success)'
                      : status[conn.id] === 'fail'
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
            {testing[conn.id] && (
              <span className="model-status">{t('testing')}</span>
            )}
            {status[conn.id] === 'ok' && (
              <span className="model-status model-status--ok">
                <Zap size={11} strokeWidth={2} /> {t('testOk')}
              </span>
            )}
            {status[conn.id] === 'fail' && (
              <span className="model-status model-status--fail">
                <X size={11} strokeWidth={2} /> {t('testFail')}
              </span>
            )}
            <div className="card__foot">
              <span className="spacer" />
              <button
                type="button"
                className="icon-btn"
                title={t('authorize')}
                disabled={preparing}
                onClick={() =>
                  void openDbSchema({
                    id: conn.id,
                    scope: conn.scope,
                    name: conn.name,
                  })
                }
              >
                <KeyRound size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={t('test')}
                disabled={testing[conn.id]}
                onClick={() => void runTest(conn)}
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
