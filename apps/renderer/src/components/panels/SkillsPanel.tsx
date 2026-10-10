import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookMarked, Plus, Trash2 } from 'lucide-react';
import type { ConfigScope } from '@fireeyeaud/shared';
import { useSkillsStore } from '../../store/skills';
import { useWorkspaceStore } from '../../store/workspace';

interface FormState {
  name: string;
  prompt: string;
  toolIds: string;
  scope: ConfigScope;
}

const EMPTY_FORM: FormState = { name: '', prompt: '', toolIds: '', scope: 'project' };

function parseTokens(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function SkillsPanel() {
  const { t } = useTranslation('skills');
  const { t: te } = useTranslation('enums');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');

  const items = useSkillsStore((s) => s.items);
  const loading = useSkillsStore((s) => s.loading);
  const errorKey = useSkillsStore((s) => s.errorKey);
  const load = useSkillsStore((s) => s.load);
  const create = useSkillsStore((s) => s.create);
  const toggle = useSkillsStore((s) => s.toggle);
  const remove = useSkillsStore((s) => s.remove);
  const path = useWorkspaceStore((s) => s.path);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (path) void load();
  }, [load, path]);

  const submit = async () => {
    if (!form.name.trim() || !form.prompt.trim()) return;
    setBusy(true);
    const ok = await create({
      name: form.name.trim(),
      prompt: form.prompt.trim(),
      toolIds: parseTokens(form.toolIds),
      enabled: true,
      scope: form.scope,
    });
    setBusy(false);
    if (ok) {
      setShowForm(false);
      setForm(EMPTY_FORM);
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
        onClick={() => setShowForm((v) => !v)}
      >
        <Plus size={12} strokeWidth={2} /> {t('addSkill')}
      </button>

      {showForm && (
        <div className="card db-form">
          <input
            className="searchbox"
            placeholder={t('name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <textarea
            className="searchbox"
            rows={3}
            placeholder={t('prompt')}
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
          />
          <input
            className="searchbox"
            placeholder={t('tools')}
            value={form.toolIds}
            onChange={(e) => setForm({ ...form, toolIds: e.target.value })}
          />
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
              disabled={busy || !form.name.trim() || !form.prompt.trim()}
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
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  onClick={() => void remove(skill.id, skill.scope as ConfigScope)}
                >
                  <Trash2 size={12} strokeWidth={2} />
                </button>
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
