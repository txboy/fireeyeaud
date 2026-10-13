import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { AuditRule } from '@fireeyeaud/shared';
import { useRulesStore } from '../../store/rules';
import { useDatabaseStore } from '../../store/database';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';

/** 试跑数据库下拉：跟随规则默认 / 工作区数据 / 具体连接。 */
const FOLLOW_RULE = '__rule__';
const WORKSPACE = '__workspace__';

function PreviewBlock({ rule }: { rule: AuditRule }) {
  const { t } = useTranslation('rules');
  const preview = useRulesStore((s) => s.previewById[rule.id]);
  if (!preview) return null;
  const rows = (preview.rows as unknown[][]) ?? [];
  const columns = (preview.columns as string[]) ?? [];
  if (rows.length === 0) {
    return (
      <div className="rule-preview">
        <span className="card__meta">{t('noRows')}</span>
      </div>
    );
  }
  return (
    <div className="rule-preview">
      <span className="card__meta">
        {t('rows', { count: (preview.rowCount as number) ?? rows.length })}
      </span>
      <table className="rule-preview__table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j}>{String(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
  const preview = useRulesStore((s) => s.preview);
  const openForm = useUiStore((s) => s.openForm);
  const connections = useDatabaseStore((s) => s.items);
  const loadConnections = useDatabaseStore((s) => s.load);
  const path = useWorkspaceStore((s) => s.path);

  const [runDb, setRunDb] = useState<string>(FOLLOW_RULE);

  useEffect(() => {
    if (!path) return;
    void load();
    void loadConnections();
  }, [load, loadConnections, path]);

  const doPreview = (rule: AuditRule) => {
    let sourceId: string | undefined;
    if (runDb === WORKSPACE) sourceId = undefined;
    else if (runDb === FOLLOW_RULE) sourceId = rule.databaseId ?? undefined;
    else sourceId = runDb;
    void preview(rule.id, sourceId);
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
        onClick={() => void openForm('rules', 'create')}
      >
        <Plus size={12} strokeWidth={2} /> {t('addRule')}
      </button>

      <div className="field">
        <span className="field__label">{t('pickDatabase')}</span>
        <select
          className="searchbox"
          value={runDb}
          onChange={(e) => setRunDb(e.target.value)}
        >
          <option value={FOLLOW_RULE}>{t('followRule')}</option>
          <option value={WORKSPACE}>{t('workspace')}</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

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
                onClick={() => doPreview(rule)}
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
            <PreviewBlock rule={rule} />
          </div>
        ))
      )}
    </>
  );
}
