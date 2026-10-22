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
import { ArchiveSettingsDialog } from '../archive/ArchiveSettingsDialog';
import { ConflictDialog } from '../archive/ConflictDialog';
import { RestoreDialog } from '../archive/RestoreDialog';
import { useArchiveStore } from '../../store/archive';
import { useWorkspaceStore } from '../../store/workspace';
import type { ArchiveConflictCheck } from '@fireeyeaud/shared';

/** 成果栏「归档」：Git 归档、推送、分叉解决与还原。 */
export function ArchiveView() {
  const { t } = useTranslation('archive');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const status = useArchiveStore((s) => s.status);
  const history = useArchiveStore((s) => s.history);
  const changes = useArchiveStore((s) => s.changes);
  const loading = useArchiveStore((s) => s.loading);
  const errorKey = useArchiveStore((s) => s.errorKey);
  const load = useArchiveStore((s) => s.load);
  const init = useArchiveStore((s) => s.init);
  const commit = useArchiveStore((s) => s.commit);
  const push = useArchiveStore((s) => s.push);
  const loadChanges = useArchiveStore((s) => s.loadChanges);
  const check = useArchiveStore((s) => s.check);

  const wsPath = useWorkspaceStore((s) => s.path);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [conflict, setConflict] = useState<ArchiveConflictCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (wsPath) void load();
  }, [load, wsPath]);

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

  const checkNow = async () => {
    setBusy(true);
    try {
      const result = await check();
      if (result.diverged) {
        setConflict(result);
      } else {
        setConflict(null);
        void message.info(result.behind ? t('behind') : t('noConflict'));
      }
    } catch {
      /* store 已记录 errorKey */
    } finally {
      setBusy(false);
    }
  };

  const toggleChanges = async (archiveId: string) => {
    if (expanded === archiveId) {
      setExpanded(null);
      return;
    }
    setExpanded(archiveId);
    if (!changes[archiveId]) await loadChanges(archiveId);
  };

  return (
    <>
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
          <div className="archive-status__value">{status.author.name}</div>
        </div>
        <div>
          <div className="archive-status__label">{t('history')}</div>
          <div className="archive-status__value">
            {status.dirty ? t('dirty') : t('clean')}
          </div>
        </div>
      </div>

      <div className="archive-actions" style={{ margin: '10px 0' }}>
        <button type="button" className="button button--sm" disabled={busy} onClick={() => void archiveNow()}>
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
          disabled={busy || !status.canPush}
          onClick={() => void checkNow()}
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
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={12} strokeWidth={1.9} /> {t('settings')}
        </button>
      </div>

      {status.dirty && (
        <div className="card__meta" style={{ marginBottom: 8 }}>
          <TriangleAlert size={11} strokeWidth={2} /> {t('dirtyHint')} ·{' '}
          {t('changedCount', { count: status.changed.length })}
        </div>
      )}

      {errorKey && (
        <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
      )}

      <div className="card__meta" style={{ marginBottom: 4 }}>
        {t('history')}
      </div>
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
                onClick={() => void toggleChanges(item.id)}
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
                {t('changedCount', {
                  count:
                    (item.manifest.counts.findings ?? 0) +
                    (item.manifest.counts.evidenceForms ?? 0) +
                    (item.manifest.counts.reports ?? 0),
                })}
              </div>
            )}
            {expanded === item.id && (
              <div className="archive-row__meta">
                {(changes[item.id] ?? []).length === 0 ? (
                  <span>{tc('loading')}</span>
                ) : (
                  changes[item.id].map((change) => (
                    <div key={change.path}>
                      {change.status} · {change.path}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))
      )}

      <ArchiveSettingsDialog
        open={settingsOpen}
        status={status}
        onClose={() => setSettingsOpen(false)}
      />
      <ConflictDialog
        check={conflict}
        onClose={() => setConflict(null)}
        onResolved={() => void load()}
      />
      <RestoreDialog
        open={restoreOpen}
        history={history}
        onClose={() => setRestoreOpen(false)}
      />
    </>
  );
}