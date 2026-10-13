import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BookMarked, Pencil, Plus, Trash2 } from 'lucide-react';
import { ScopeBadge } from '../ScopeBadge';
import { StateChip } from '../StateChip';
import { useSkillsStore } from '../../store/skills';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';

export function SkillsPanel() {
  const { t } = useTranslation('skills');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');

  const items = useSkillsStore((s) => s.items);
  const loading = useSkillsStore((s) => s.loading);
  const errorKey = useSkillsStore((s) => s.errorKey);
  const load = useSkillsStore((s) => s.load);
  const remove = useSkillsStore((s) => s.remove);
  const openForm = useUiStore((s) => s.openForm);
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
        onClick={() => void openForm('skills', 'create')}
      >
        <Plus size={12} strokeWidth={2} /> {t('addSkill')}
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
        items.map((skill) => (
          <div key={skill.id} className="card">
            <div className="card__head">
              <BookMarked size={14} strokeWidth={1.75} />
              <span className="card__name">{skill.name}</span>
              <span className="spacer" />
              <ScopeBadge scope={skill.scope} />
              <StateChip enabled={skill.enabled} />
            </div>
            <span className="card__meta">{skill.prompt}</span>
            {skill.toolIds?.length ? (
              <span className="card__meta">
                {t('tools')}: {skill.toolIds.join(', ')}
              </span>
            ) : null}
            <div className="card__foot">
              <span className="spacer" />
              <button
                type="button"
                className="icon-btn"
                title={tc('edit')}
                onClick={() =>
                  void openForm('skills', 'edit', {
                    id: skill.id,
                    scope: skill.scope,
                    name: skill.name,
                  })
                }
              >
                <Pencil size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={tc('delete')}
                onClick={() => void remove(skill.id, skill.scope)}
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
