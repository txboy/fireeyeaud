import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Server, Trash2, X, Zap } from 'lucide-react';
import type { ModelProfile } from '@fireeyeaud/shared';
import { useModelsStore } from '../../store/models';
import { useUiStore } from '../../store/ui';
import { ScopeBadge } from '../ScopeBadge';

export function ModelsPanel() {
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');
  const { t: te } = useTranslation('error');
  const items = useModelsStore((s) => s.items);
  const loading = useModelsStore((s) => s.loading);
  const errorKey = useModelsStore((s) => s.errorKey);
  const load = useModelsStore((s) => s.load);
  const remove = useModelsStore((s) => s.remove);
  const test = useModelsStore((s) => s.test);
  const openForm = useUiStore((s) => s.openForm);

  const [status, setStatus] = useState<Record<string, 'ok' | 'fail'>>({});

  useEffect(() => {
    void load();
  }, [load]);

  const runTest = async (item: ModelProfile) => {
    try {
      const ok = await test(item.id, item.scope);
      setStatus((s) => ({ ...s, [item.id]: ok ? 'ok' : 'fail' }));
    } catch {
      setStatus((s) => ({ ...s, [item.id]: 'fail' }));
    }
  };

  return (
    <>
      <button
        type="button"
        className="button button--sm"
        onClick={() => void openForm('models', 'create')}
      >
        <Plus size={12} strokeWidth={2} />
        {t('addModel')}
      </button>

      {errorKey && (
        <span className="panel-error">{te(errorKey.replace(/^error\./, ''))}</span>
      )}

      {items.length === 0 && !loading && (
        <div className="panel-empty">
          <Server size={22} strokeWidth={1.5} />
          <span>{t('empty')}</span>
        </div>
      )}

      {items.map((item) => (
        <div key={item.id} className="card">
          <div className="card__row">
            <Server size={14} strokeWidth={1.75} />
            <span className="card__name">{item.name}</span>
            {item.isDefault && <span className="scope-badge">{t('isDefault')}</span>}
            <ScopeBadge scope={item.scope} />
            <span className="spacer" />
            <button
              type="button"
              className="icon-btn"
              title={tc('test')}
              onClick={() => void runTest(item)}
            >
              <Zap size={13} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={tc('edit')}
              onClick={() =>
                void openForm('models', 'edit', {
                  id: item.id,
                  scope: item.scope,
                  name: item.name,
                })
              }
            >
              <Pencil size={13} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={tc('delete')}
              onClick={() => void remove(item.id, item.scope)}
            >
              <Trash2 size={13} strokeWidth={1.75} />
            </button>
          </div>
          <span className="card__meta">
            {item.model} · {item.baseUrl}
          </span>
          {status[item.id] === 'ok' && (
            <span className="model-status model-status--ok">
              <Zap size={11} strokeWidth={2} /> {t('testOk')}
            </span>
          )}
          {status[item.id] === 'fail' && (
            <span className="model-status model-status--fail">
              <X size={11} strokeWidth={2} /> {t('testFail')}
            </span>
          )}
        </div>
      ))}
    </>
  );
}
