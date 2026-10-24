import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { message } from 'antd';
import {
  Archive as ArchiveIcon,
  CloudUpload,
  GitBranch,
  RefreshCw,
  RotateCcw,
  Settings2,
  TriangleAlert,
} from 'lucide-react';
import { RestoreDialog } from './RestoreDialog';
import { useArchiveStore } from '../../store/archive';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';

/**
 * 左侧活动栏「归档」：与「项目报告」「取证单」同构的上下分栏面板——
 * 上栏归档状态与操作，下栏归档历史；差异 / 变更 / 远程设置都在右侧 tab 打开。
 */
export function ArchivePanel() {
  const { t } = useTranslation('archive');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const status = useArchiveStore((s) => s.status);
  const history = useArchiveStore((s) => s.history);
  const loading = useArchiveStore((s) => s.loading);
  const errorKey = useArchiveStore((s) => s.errorKey);
  const load = useArchiveStore((s) => s.load);
  const reset = useArchiveStore((s) => s.reset);
  const init = useArchiveStore((s) => s.init);
  const commit = useArchiveStore((s) => s.commit);
  const push = useArchiveStore((s) => s.push);

  const wsPath = useWorkspaceStore((s) => s.path);
  const openArchiveDiff = useUiStore((s) => s.openArchiveDiff);
  const openArchiveChanges = useUiStore((s) => s.openArchiveChanges);
  const openArchiveRemote = useUiStore((s) => s.openArchiveRemote);

  const [restoreOpen, setRestoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!wsPath) return;
    reset();
    void load();
  }, [load, reset, wsPath]);

  if (!wsPath) {
    return (
      <div className="panel-empty">
        <span>{tc('noWorkspace')}</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="panel-empty">
        <span>{loading ? tc('loading') : t('initHint')}</span>
      </div>
    );
  }

  if (!status.initialized) {
    return (
      <div className="panel-empty">
        <ArchiveIcon size={22} strokeWidth={1.5} />
        <p>{t('initHint')}</p>
        <button
          type="button"
          className="button"
          onClick={() => void init().catch(() => undefined)}
        >
          {t('init')}
        </button>
      </div>
    );
  }

  const archiveNow = async () => {
    setBusy(true);
    try {
      await commit();
      if (status?.remote.autoPush && status?.canPush) {
        await push();
        void message.success(t('pushed'));
      } else {
        void message.success(t('archived'));
      }
    } catch {
      /* store 已记录 errorKey */
    } finally {
      setBusy(false);
    }
  };

  const pushNow = async (archiveId?: string) => {
    setBusy(true);
    try {
      const result = await push(archiveId);
      const skipped = result.skipped ?? [];
      if (skipped.length > 0) {
        void message.warning(t('pushSkipped', { count: skipped.length }));
      } else {
        void message.success(t('pushed'));
      }
    } catch {
      /* store 已记录 errorKey */
    } finally {
      setBusy(false);
    }
  };

  const totalChanged = (item: (typeof history)[number]) =>
    item.manifest
      ? item.manifest.counts.findings +
        item.manifest.counts.evidenceForms +
        item.manifest.counts.reports
      : 0;

  return (
    <div className="reports-panel">
      <section className="reports-pane">
        <div className="reports-pane__head">
          <span className="reports-pane__title">{t('statusTitle')}</span>
          <span className="spacer" />
          <span className="card__meta">
            {status.dirty
              ? t('changedCount', { count: status.changed.length })
              : t('clean')}
          </span>
        </div>

        <div className="reports-pane__body">
          <div className="archive-status">
            <div>
              <div className="archive-status__label">{t('branch')}</div>
              <div className="archive-status__value">
                <GitBranch size={12} strokeWidth={1.8} /> {status.branch}
              </div>
            </div>
            <div>
              <div className="archive-status__label">{t('head')}</div>
              <div className="archive-status__value">{status.head?.slice(0, 8) ?? '—'}</div>
            </div>
            <div>
              <div className="archive-status__label">{t('remote')}</div>
              <div className="archive-status__value" title={status.remote.remoteUrl}>
                {status.remote.remoteUrl || t('notConfigured')}
              </div>
            </div>
            <div>
              <div className="archive-status__label">{t('lastArchive')}</div>
              <div className="archive-status__value">{status.lastArchive ?? '—'}</div>
            </div>
            <div>
              <div className="archive-status__label">{t('author')}</div>
              <div className="archive-status__value">{status.author.name || '—'}</div>
            </div>
          </div>

          <div className="archive-actions archive-actions--panel">
            <button
              type="button"
              className="button button--sm"
              disabled={busy}
              onClick={() => void archiveNow()}
            >
              <ArchiveIcon size={12} strokeWidth={1.9} /> {t('archiveNow')}
            </button>
            <button
              type="button"
              className="button button--sm button--ghost"
              disabled={busy || !status.canPush}
              onClick={() => void pushNow()}
            >
              <CloudUpload size={12} strokeWidth={1.9} /> {t('push')}
            </button>
            <button
              type="button"
              className="button button--sm button--ghost"
              disabled={busy}
              onClick={() => void openArchiveDiff()}
            >
              <RefreshCw size={12} strokeWidth={1.9} /> {t('checkConflict')}
            </button>
            <button
              type="button"
              className="button button--sm button--ghost"
              disabled={busy}
              onClick={() => setRestoreOpen(true)}
            >
              <RotateCcw size={12} strokeWidth={1.9} /> {t('restore')}
            </button>
            <button
              type="button"
              className="button button--sm button--ghost"
              onClick={() => void openArchiveRemote()}
            >
              <Settings2 size={12} strokeWidth={1.9} /> {t('settings')}
            </button>
          </div>

          {status.dirty && (
            <div className="card__meta archive-dirty-hint">
              <TriangleAlert size={11} strokeWidth={2} /> {t('dirtyHint')}
            </div>
          )}

          {errorKey && (
            <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
          )}
        </div>
      </section>

      <section className="reports-pane reports-pane--forms">
        <div className="reports-pane__head">
          <span className="reports-pane__title">{t('history')}</span>
          <span className="spacer" />
          <span className="card__meta">{history.length}</span>
        </div>
        <div className="reports-pane__body">
          {history.length === 0 ? (
            <div className="panel-empty">
              <span>{t('empty')}</span>
            </div>
          ) : (
            history.map((item) => (
              <div key={item.id} className="archive-row">
                <div className="archive-row__top">
                  <span className="archive-row__id">{item.id}</span>
                  {item.pushed && <span className="receipt-badge">{t('pushed')}</span>}
                  <span className="spacer" />
                  <button
                    type="button"
                    className="button button--sm button--ghost"
                    onClick={() => void openArchiveChanges(item.id, item.id)}
                  >
                    {t('viewChanges')}
                  </button>
                  <button
                    type="button"
                    className="button button--sm button--ghost"
                    disabled={busy || !status.canPush}
                    onClick={() => void pushNow(item.id)}
                  >
                    {t('pushThis')}
                  </button>
                </div>
                <div className="archive-row__meta">
                  {item.createdAt.slice(0, 19).replace('T', ' ')} · {item.author.name || '—'} ·{' '}
                  {item.message}
                </div>
                {item.manifest && (
                  <div className="archive-row__meta">
                    {t('changedCount', { count: totalChanged(item) })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <RestoreDialog
        open={restoreOpen}
        history={history}
        onClose={() => setRestoreOpen(false)}
      />
    </div>
  );
}