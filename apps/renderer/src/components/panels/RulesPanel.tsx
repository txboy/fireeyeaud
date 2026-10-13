import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useRulesStore } from '../../store/rules';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';

export function RulesPanel() {
  const { t } = useTranslation('rules');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const items = useRulesStore((s) => s.items);
  const loading = useRulesStore((s) => s.loading);
  const errorKey = useRulesStore((s) => s.errorKey);
  const load = useRulesStore((s) => s.load);
  const edit = useRulesStore((s) => s.edit);
  const remove = useRulesStore((s) => s.remove);
  const openForm = useUiStore((s) => s.openForm);
  const openRuleRun = useUiStore((s) => s.openRuleRun);
  const path = useWorkspaceStore((s) => s.path);

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
        onClick={() => void openForm('rules', 'create')}
      >
        <Plus size={12} strokeWidth={2} /> {t('addRule')}
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
        items.map((rule) => (
          <div key={rule.id} className="card">
            <div className="card__row">
              <ShieldCheck size={14} strokeWidth={1.75} />
              <span className="card__name">{rule.name || rule.id}</span>
              <span className="spacer" />
              <label className="db-col">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => void edit(rule.id, { enabled: e.target.checked })}
                />
                <span>{t('enabled')}</span>
              </label>
              <button
                type="button"
                className="icon-btn"
                title={t('preview')}
                onClick={() => void openRuleRun(rule.id, rule.name || rule.id)}
              >
                <Play size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={tc('edit')}
                onClick={() =>
                  void openForm('rules', 'edit', {
                    id: rule.id,
                    scope: 'project',
                    name: rule.name || rule.id,
                  })
                }
              >
                <Pencil size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className="button button--sm button--ghost"
                title={tc('delete')}
                onClick={() => void remove(rule.id)}
              >
                <Trash2 size={12} strokeWidth={2} />
              </button>
            </div>
            {rule.description && <span className="card__meta">{rule.description}</span>}
            {rule.sql && <span className="card__meta rule-def">{rule.sql}</span>}
          </div>
        ))
      )}
    </>
  );
}
