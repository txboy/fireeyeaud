import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Radio } from 'antd';
import { GitCompareArrows, RefreshCw } from 'lucide-react';
import type { ArchiveConflictCheck } from '@fireeyeaud/shared';
import { describeConflict, isSameCheck } from '../../lib/archiveDiff';
import { useArchiveStore } from '../../store/archive';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';
import { errorKeyOf } from '../../lib/errorKey';

type Choice = 'local' | 'remote' | 'both' | 'auto';

/**
 * 右侧「差异与冲突」tab：始终反映当前工作区与远程的差异。
 * 未分叉时只展示差异；分叉时展示逐文件冲突并允许一步合并归档。
 */
export function ArchiveDiffTab() {
  const { t } = useTranslation('archive');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const status = useArchiveStore((s) => s.status);
  const load = useArchiveStore((s) => s.load);
  const checkApi = useArchiveStore((s) => s.check);
  const resolve = useArchiveStore((s) => s.resolve);
  const wsPath = useWorkspaceStore((s) => s.path);
  const openArchiveRemote = useUiStore((s) => s.openArchiveRemote);

  /** undefined = 还没跑过检查；null = 后端确实没有远程。 */
  const [check, setCheck] = useState<ArchiveConflictCheck | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [base, setBase] = useState<'local' | 'remote'>('local');
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<ArchiveConflictCheck | null> => {
    setLoading(true);
    setErrorKey(null);
    try {
      const result = await checkApi();
      setCheck(result);
      setBase('local');
      setChoices(
        Object.fromEntries(
          result.conflicts.map((item) => [item.path, item.autoMerge ? 'auto' : 'local']),
        ),
      );
      return result;
    } catch (err) {
      setErrorKey(errorKeyOf(err));
      // 检查失败：退回「未检查」并保留错误提示，不冒认成「没配远程」
      setCheck(undefined);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [checkApi]);

  useEffect(() => {
    if (!wsPath) return;
    void load();
    void refresh().catch(() => undefined);
  }, [load, refresh, wsPath]);

  const view = useMemo(() => describeConflict(check), [check]);

  const submit = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      // 提交前先复查：期间若已归档或被他人推送，路径集合会变，旧裁决无法安全套用
      const latest = await checkApi();
      if (!isSameCheck(latest, check ?? null)) {
        setCheck(latest);
        setBase('local');
        setChoices(
          Object.fromEntries(
            latest.conflicts.map((item) => [item.path, item.autoMerge ? 'auto' : 'local']),
          ),
        );
        setErrorKey('error.archiveChanged');
        return;
      }
      await resolve({
        base,
        choices,
        message: `合并归档 ${new Date().toISOString().slice(0, 10)}`,
      });
      await refresh();
    } catch (err) {
      const key = (err as { messageKey?: string }).messageKey;
      if (key) setErrorKey(key);
    } finally {
      setBusy(false);
    }
  };

  if (!wsPath) {
    return (
      <div className="tab-empty">
        <span>{tc('noWorkspace')}</span>
      </div>
    );
  }

  const conflicts = check?.conflicts ?? [];

  return (
    <div className="archive-diff">
      <div className="archive-diff__head">
        <span className="archive-diff__title">
          <GitCompareArrows size={14} strokeWidth={1.8} /> {t('diffTitle')}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="button button--sm button--ghost"
          disabled={loading}
          onClick={() => void refresh().catch(() => undefined)}
        >
          <RefreshCw size={12} strokeWidth={1.9} />{' '}
          {loading ? tc('loading') : t('recheck')}
        </button>
      </div>

      {errorKey && (
        <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
      )}

      {view.mode === 'checking' ? (
        <div className="tab-empty">
          <span>{loading ? tc('loading') : t('recheck')}</span>
        </div>
      ) : view.mode === 'no-remote' ? (
        <div className="tab-empty tab-empty--stack">
          <span>{t('noRemoteForDiff')}</span>
          <button
            type="button"
            className="button button--sm"
            onClick={() => void openArchiveRemote()}
          >
            {t('settings')}
          </button>
        </div>
      ) : view.mode === 'no-local' ? (
        <div className="tab-empty">
          <span>{t('noLocalCommit')}</span>
        </div>
      ) : (
        <>
          <div className="archive-diff__summary">
            <DiffBadge
              label={t('localState')}
              value={check?.local?.slice(0, 8) ?? '—'}
              tone={view.mode === 'behind' ? 'muted' : 'ok'}
            />
            <DiffBadge
              label={t('remoteVersion')}
              value={check?.remote?.slice(0, 8) ?? '—'}
              tone={view.mode === 'ahead' ? 'muted' : 'ok'}
            />
            <span className={`archive-diff__state archive-diff__state--${view.mode}`}>
              {t(`state.${view.mode}`)}
            </span>
          </div>

          {view.mode === 'synced' && (
            <div className="tab-empty">
              <span>{t('syncedHint')}</span>
            </div>
          )}

          {view.mode === 'ahead' && (
            <div className="card__meta archive-diff__hint">{t('aheadHint')}</div>
          )}

          {view.mode === 'behind' && (
            <div className="card__meta archive-diff__hint">{t('behind')}</div>
          )}

          {(view.mode === 'ahead' || view.mode === 'behind') && status?.dirty && (
            <section className="archive-diff__section">
              <div className="archive-diff__section-title">
                {t('uncommitted')} · {t('changedCount', { count: status.changed.length })}
              </div>
              <ul className="archive-diff__list">
                {status.changed.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            </section>
          )}

          {view.mode === 'diverged' && (
            <>
              <div className="archive-diff__sides">
                <section className="archive-diff__section">
                  <div className="archive-diff__section-title">
                    {t('remoteOnly')} · {view.remoteOnlyCount}
                  </div>
                  {check && check.remoteOnly.length === 0 ? (
                    <div className="card__meta">{t('none')}</div>
                  ) : (
                    <ul className="archive-diff__list">
                      {check?.remoteOnly.map((path) => (
                        <li key={path}>{path}</li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="archive-diff__section">
                  <div className="archive-diff__section-title">
                    {t('localOnly')} · {view.localOnlyCount}
                  </div>
                  {check && check.localOnly.length === 0 ? (
                    <div className="card__meta">{t('none')}</div>
                  ) : (
                    <ul className="archive-diff__list">
                      {check?.localOnly.map((path) => (
                        <li key={path}>{path}</li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <section className="archive-diff__section">
                <div className="archive-diff__section-title">
                  {t('conflictTitle')} · {view.conflictCount}
                </div>

                <Radio.Group
                  value={base}
                  onChange={(e) => setBase(e.target.value as 'local' | 'remote')}
                  className="archive-diff__base"
                >
                  <Radio value="local">{t('baseLocal')}</Radio>
                  <Radio value="remote">{t('baseRemote')}</Radio>
                </Radio.Group>

                {conflicts.length === 0 ? (
                  <div className="card__meta">{t('noConflict')}</div>
                ) : (
                  <div className="conflict-list">
                    {conflicts.map((item) => (
                      <div key={item.path} className="conflict-row">
                        <div className="conflict-row__main">
                          <span className="artifact-row__title">{item.path}</span>
                          <span className="card__meta">
                            {t('local')}: {item.localStatus} · {t('remoteVersion')}:{' '}
                            {item.remoteStatus}
                          </span>
                          {item.hint && (
                            <span className="card__meta">{t('evidenceWarning')}</span>
                          )}
                        </div>
                        <select
                          className="searchbox"
                          value={choices[item.path] ?? 'local'}
                          onChange={(e) =>
                            setChoices((prev) => ({
                              ...prev,
                              [item.path]: e.target.value as Choice,
                            }))
                          }
                        >
                          <option value="local">{t('local')}</option>
                          <option value="remote">{t('remoteVersion')}</option>
                          <option value="both">{t('both')}</option>
                          {item.autoMerge && <option value="auto">{t('auto')}</option>}
                        </select>
                      </div>
                    ))}
                  </div>
                )}

                <div className="archive-diff__footer">
                  <span className="card__meta">{t('divergedHint')}</span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="button button--sm"
                    disabled={busy || loading}
                    onClick={() => void submit()}
                  >
                    {busy ? tc('loading') : t('resolve')}
                  </button>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function DiffBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'muted';
}) {
  return (
    <span className={`archive-diff__badge archive-diff__badge--${tone}`}>
      <span className="archive-diff__badge-label">{label}</span>
      <span className="archive-diff__badge-value">{value}</span>
    </span>
  );
}