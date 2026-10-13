import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Save } from 'lucide-react';
import type { RuleRunResult } from '@fireeyeaud/shared';
import type { RuleRunTab } from '../store/ui';
import { useRulesStore } from '../store/rules';
import { useDatabaseStore } from '../store/database';
import { runRuleApi } from '../lib/api';

/** 工作区 DuckDB 对应空 sourceId。 */
const WORKSPACE = '';

/** 规则试跑工作台：编辑 SQL、选库执行、查看结果、保存回规则。 */
export function RuleRunView({ tab }: { tab: RuleRunTab }) {
  const { t } = useTranslation('rules');
  const { t: terr } = useTranslation('error');
  const rule = useRulesStore((s) => s.items.find((r) => r.id === tab.ruleId));
  const edit = useRulesStore((s) => s.edit);
  const connections = useDatabaseStore((s) => s.items);
  const loadConnections = useDatabaseStore((s) => s.load);

  const [sql, setSql] = useState('');
  const [sourceId, setSourceId] = useState<string>(WORKSPACE);
  const [result, setResult] = useState<RuleRunResult | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const initialized = useRef<string | null>(null);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (rule && initialized.current !== rule.id) {
      initialized.current = rule.id;
      setSql(rule.sql);
      setSourceId(rule.databaseId ?? WORKSPACE);
    }
  }, [rule]);

  const run = async () => {
    if (!sql.trim()) return;
    setBusy(true);
    setErrorKey(null);
    setSaved(false);
    try {
      const res = await runRuleApi(tab.ruleId, { sql, sourceId });
      setResult(res);
    } catch (err) {
      setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!rule) return;
    const ok = await edit(tab.ruleId, rule.scope, { sql });
    if (ok) setSaved(true);
  };

  const rows = result?.rows ?? [];
  const columns = result?.columns ?? [];

  return (
    <div className="formtab">
      <div className="formtab__head">
        <Play size={14} strokeWidth={1.75} />
        <span className="formtab__title">{rule?.name || tab.name}</span>
      </div>
      <div className="formtab__body">
        {!rule ? (
          <div className="panel-empty">
            <span>{terr('notFound')}</span>
          </div>
        ) : (
          <div className="formtab__form rule-run__form">
            <label className="field">
              <span className="field__label">{t('sql')}</span>
              <textarea
                className="searchbox"
                rows={10}
                value={sql}
                onChange={(e) => {
                  setSql(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <label className="field">
              <span className="field__label">{t('database')}</span>
              <select
                className="searchbox"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
                <option value={WORKSPACE}>{t('workspace')}</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="formtab__actions">
              <button
                type="button"
                className="button"
                disabled={busy || !sql.trim()}
                onClick={() => void run()}
              >
                <Play size={13} strokeWidth={1.9} /> {t('execute')}
              </button>
              <button
                type="button"
                className="button button--ghost"
                disabled={busy}
                onClick={() => void save()}
              >
                <Save size={13} strokeWidth={1.9} /> {t('save')}
              </button>
            </div>
            {saved && <span className="card__meta">{t('saved')}</span>}
            {errorKey && (
              <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
            )}

            {result && (
              <div className="rule-preview">
                {rows.length === 0 ? (
                  <span className="card__meta">{t('noRows')}</span>
                ) : (
                  <>
                    <span className="card__meta">
                      {t('rows', { count: result.rowCount })}
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
                        {rows.slice(0, 50).map((r, i) => (
                          <tr key={i}>
                            {r.map((v, j) => (
                              <td key={j}>{String(v)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
