import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BookMarked, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ConfigScope } from '@fireeyeaud/shared';
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
  const toggle = useSkillsStore((s) => s.toggle);
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
            <div className="card__row">
              <BookMarked size={13} strokeWidth={1.75} />
              <span className="card__name">{skill.name}</span>
              {skill.builtin && <span className="scope-badge">{t('builtin')}</span>}
              <span className="spacer" />
              <label className="db-col">
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={(e) =>
                    void toggle(
                      skill.id,
                      skill.builtin ? 'project' : (skill.scope as ConfigScope),
                      e.target.checked,
                    )
                  }
                />
                <span>{t('enabled')}</span>
              </label>
              {!skill.builtin && (
                <>
                  <button
                    type="button"
                    className="icon-btn"
                    title={tc('edit')}
                    onClick={() =>
                      void openForm('skills', 'edit', {
                        id: skill.id,
                        scope: skill.scope as ConfigScope,
                        name: skill.name,
                      })
                    }
                  >
                    <Pencil size={13} strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    className="button button--sm button--ghost"
                    onClick={() => void remove(skill.id, skill.scope as ConfigScope)}
                  >
                    <Trash2 size={12} strokeWidth={2} />
                  </button>
                </>
              )}
            </div>
            <span className="card__meta">{skill.prompt}</span>
            {skill.toolIds?.length ? (
              <span className="card__meta">
                {t('tools')}: {skill.toolIds.join(', ')}
              </span>
            ) : null}
          </div>
        ))
      )}
    </>
  );
}
