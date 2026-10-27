import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronRight, Clock, CloudDownload, FolderOpen, Loader2, X } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspace';
import { useSidecarStore } from '../store/sidecar';
import { logoUrl } from '../lib/logo';
import { RestoreFromRemoteDialog } from './archive/RestoreFromRemoteDialog';

/** 相对时间（刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前）。 */
function relativeTime(ts: number, t: TFunction): string {
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return t('justNow');
  if (minutes < 60) return t('minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return days <= 1 ? t('yesterday') : t('daysAgo', { count: days });
}

export function Welcome() {
  const { t } = useTranslation('welcome');
  const { t: tc } = useTranslation('common');
  const { t: te } = useTranslation('error');
  const recent = useWorkspaceStore((s) => s.recent);
  const loading = useWorkspaceStore((s) => s.loading);
  const errorKey = useWorkspaceStore((s) => s.errorKey);
  const sidecarStatus = useSidecarStore((s) => s.info?.status ?? 'starting');
  const openFromDialog = useWorkspaceStore((s) => s.openFromDialog);
  const openPath = useWorkspaceStore((s) => s.openPath);
  const removeRecent = useWorkspaceStore((s) => s.removeRecent);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const mostRecent = recent[0];
  // 后端还在启动：不拦用户点，但要说清「正在启动 Agent 服务」，而不是报内部错误。
  // 打开失败要能区分：Agent 还在启动 → 提示启动中；后端就绪但真失败 → 显示错误 + 重试。
  const sidecarStarting = sidecarStatus === 'starting';
  const rolling = loading || sidecarStarting;
  const failed = Boolean(errorKey) && !rolling;
  const lastOpened = useRef<string | null>(null);

  return (
    <div className="welcome">
      <div className="welcome__center">
        <img className="welcome__mark" src={logoUrl} alt="" draggable={false} />
        <h1 className="welcome__title">{tc('appName')}</h1>
        <p className="welcome__tagline">{t('tagline')}</p>

        <div className="welcome__actions">
          <button
            type="button"
            className="welcome__btn welcome__btn--primary"
            disabled={loading}
            onClick={() => void openFromDialog()}
          >
            {loading ? <Loader2 size={15} className="welcome__spin" /> : <FolderOpen size={15} />}
            {tc('openFolder')}
          </button>
          <button
            type="button"
            className="welcome__btn welcome__btn--ghost"
            disabled={!mostRecent || loading}
            onClick={() => {
              if (mostRecent) lastOpened.current = mostRecent.path;
              if (mostRecent) void openPath(mostRecent.path);
            }}
          >
            <Clock size={15} />
            {t('openRecent')}
          </button>
          <button
            type="button"
            className="welcome__btn welcome__btn--ghost"
            disabled={loading}
            onClick={() => setRestoreOpen(true)}
          >
            <CloudDownload size={15} />
            {t('restoreFromRemote')}
          </button>
        </div>

        {sidecarStarting && (
          <div className="welcome__status" role="status">
            <Loader2 size={13} className="welcome__spin" />
            <span>{tc('sidecarStarting')}</span>
          </div>
        )}

        {loading && (
          <div className="welcome__status" role="status">
            <Loader2 size={13} className="welcome__spin" />
            <span>{t('opening')}</span>
          </div>
        )}

        {failed && (
          <div className="welcome__error" role="alert">
            <span>{te((errorKey ?? 'error.internal').replace(/^error\./, ''))}</span>
            <button
              type="button"
              className="button button--sm"
              onClick={() => {
                const target = lastOpened.current ?? mostRecent?.path;
                if (target) void openPath(target);
              }}
              disabled={!lastOpened.current && !mostRecent}
            >
              {tc('retry')}
            </button>
          </div>
        )}

        {recent.length > 0 && (
          <div className="welcome__recent">
            <div className="welcome__recent-title">{t('recentTitle')}</div>
            <ul className="welcome__list">
              {recent.map((item) => (
                <li key={item.path} className="welcome__item">
                  <button
                    type="button"
                    className="welcome__item-main"
                    onClick={() => {
                      lastOpened.current = item.path;
                      void openPath(item.path);
                    }}
                  >
                    <FolderOpen size={16} className="welcome__item-icon" />
                    <span className="welcome__item-text">
                      <span className="welcome__item-name">{item.name}</span>
                      <span className="welcome__item-path">{item.path}</span>
                    </span>
                  </button>
                  <span className="welcome__item-meta">
                    <span className="welcome__badge">
                      {t('findingsCount', { count: item.findings })}
                    </span>
                    <span className="welcome__time">{relativeTime(item.lastOpenedAt, t)}</span>
                  </span>
                  <button
                    type="button"
                    className="welcome__item-remove"
                    title={t('remove')}
                    aria-label={t('remove')}
                    onClick={() => removeRecent(item.path)}
                  >
                    <X size={13} />
                  </button>
                  <ChevronRight size={15} className="welcome__chevron" />
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="welcome__privacy">{t('privacy')}</p>
      </div>

      <RestoreFromRemoteDialog
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
      />
    </div>
  );
}
