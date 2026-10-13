import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Play, Plus, ShieldCheck, Trash2, Zap } from 'lucide-react';
import type { AuditRule } from '@fireeyeaud/shared';
import { useRulesStore } from '../../store/rules';
import { useFindingsStore } from '../../store/findings';
import { useUiStore } from '../../store/ui';
import { ruleName } from '../../lib/rules';

const SEVERITIES = ['high', 'medium', 'low'] as const;

function ruleLabel(rule: AuditRule, t: (k: string) => string): string {
  if (rule.nameKey) return t(rule.nameKey);
  return ruleName(rule) || rule.id;
}

function PreviewBlock({ rule }: { rule: AuditRule }) {
  const { t } = useTranslation('rules');
  const preview = useRulesStore((s) => s.previewById[rule.id]);
  if (!preview) return null;
  if (preview.kind === 'detector') {
    const diffs = (preview.diffs as unknown[]) ?? [];
    return (
      <div className="rule-preview">
        {diffs.length === 0 ? (
          <span className="card__meta">{t('noHits')}</span>
        ) : (
          <span className="card__meta">{JSON.stringify(diffs)}</span>
        )}
      </div>
    );
  }
  const rows = (preview.rows as unknown[]) ?? [];
  return (
    <div className="rule-preview">
      <span className="card__meta">
        {t('runResult', { count: (preview.rowCount as number) ?? rows.length })}
      </span>
    </div>
  );
}

export function RulesPanel() {
  const { t } = useTranslation('rules');
  const { t: te } = useTranslation('enums');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const items = useRulesStore((s) => s.items);
  const errorKey = useRulesStore((s) => s.errorKey);
  const load = useRulesStore((s) => s.load);
  const edit = useRulesStore((s) => s.edit);
  const remove = useRulesStore((s) => s.remove);
  const preview = useRulesStore((s) => s.preview);
  const runAll = useRulesStore((s) => s.runAll);
  const reloadFindings = useFindingsStore((s) => s.load);
  const openForm = useUiStore((s) => s.openForm);

  const [runCount, setRunCount] = useState<number | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const builtin = items.filter((r) => r.builtin);
  const custom = items.filter((r) => !r.builtin);

  const doRunAll = async () => {
    const count = await runAll();
    setRunCount(count);
    await reloadFindings();
  };

  const renderRule = (rule: AuditRule) => (
    <div key={rule.id} className="card">
      <div className="card__row">
        <ShieldCheck size={14} strokeWidth={1.75} />
        <span className="card__name">{ruleLabel(rule, t)}</span>
        <span className="scope-badge">{te(`severity.${rule.severity}`)}</span>
        <span className="spacer" />
        <select
          className="rule-select"
          value={rule.severity}
          onChange={(e) => void edit(rule.id, { severity: e.target.value })}
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {te(`severity.${s}`)}
            </option>
          ))}
        </select>
        <label className="search-opt">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => void edit(rule.id, { enabled: e.target.checked })}
          />
        </label>
        <button
          type="button"
          className="icon-btn"
          title={t('preview')}
          onClick={() => void preview(rule.id)}
        >
          <Play size={13} strokeWidth={1.75} />
        </button>
        {!rule.builtin && (
          <>
            <button
              type="button"
              className="icon-btn"
              title={tc('edit')}
              onClick={() =>
                void openForm('rules', 'edit', {
                  id: rule.id,
                  scope: 'project',
                  name: ruleLabel(rule, t),
                })
              }
            >
              <Pencil size={13} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={tc('delete')}
              onClick={() => void remove(rule.id)}
            >
              <Trash2 size={13} strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>
      {rule.descriptionKey && (
        <span className="card__meta">{t(rule.descriptionKey)}</span>
      )}
      {!rule.builtin && rule.definition && (
        <span className="card__meta rule-def">{rule.definition}</span>
      )}
      <PreviewBlock rule={rule} />
    </div>
  );

  return (
    <>
      <div className="section-head">
        <span>{t('custom')}</span>
        <button
          type="button"
          className="button button--sm"
          onClick={() => void openForm('rules', 'create')}
        >
          <Plus size={13} strokeWidth={1.9} /> {t('addRule')}
        </button>
      </div>

      {errorKey && (
        <span className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</span>
      )}

      <div className="section-head">
        <span>{t('builtin')}</span>
        <button type="button" className="button button--sm" onClick={() => void doRunAll()}>
          <Zap size={13} strokeWidth={1.9} /> {t('runAll')}
        </button>
      </div>
      {runCount !== null && (
        <span className="card__meta">{t('runResult', { count: runCount })}</span>
      )}

      {builtin.map(renderRule)}
      {custom.length > 0 && <div className="sidebar__subtitle">{t('custom')}</div>}
      {custom.map(renderRule)}
    </>
  );
}
