import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SidecarStatus } from '@fireeyeaud/shared';
import { Copy, Minus, Square, X } from 'lucide-react';
import { useSidecarStore } from '../store/sidecar';
import { useWorkspaceStore } from '../store/workspace';
import { logoUrl } from '../lib/logo';

const STATUS_KEY: Record<SidecarStatus, string> = {
  running: 'statusRunning',
  starting: 'statusStarting',
  stopped: 'statusStopped',
  failed: 'statusFailed',
};

export function TitleBar() {
  const { t } = useTranslation('common');
  const info = useSidecarStore((s) => s.info);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const status: SidecarStatus = info?.status ?? 'starting';
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = window.fireeyeaud;
    if (!api?.onWindowMaximized) return;
    void api.isWindowMaximized?.().then(setMaximized);
    return api.onWindowMaximized(setMaximized);
  }, []);

  return (
    <header
      className="titlebar"
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('.titlebar__controls')) return;
        void window.fireeyeaud?.toggleMaximizeWindow();
      }}
    >
      <img className="titlebar__flame" src={logoUrl} alt="" draggable={false} />
      <span className="titlebar__brand">{t('appName')}</span>
      {workspace && <span className="titlebar__project">{workspace.name}</span>}
      <span className="titlebar__spacer" />
      <span className={`titlebar__status titlebar__status--${status}`}>
        {info?.port ? `${t(STATUS_KEY[status])} · 127.0.0.1:${info.port}` : t(STATUS_KEY[status])}
      </span>
      <div className="titlebar__controls">
        <button
          type="button"
          className="titlebar__ctl"
          aria-label={t('minimize')}
          title={t('minimize')}
          onClick={() => void window.fireeyeaud?.minimizeWindow()}
        >
          <Minus size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="titlebar__ctl"
          aria-label={maximized ? t('restore') : t('maximize')}
          title={maximized ? t('restore') : t('maximize')}
          onClick={() => void window.fireeyeaud?.toggleMaximizeWindow()}
        >
          {maximized ? <Copy size={13} strokeWidth={2} /> : <Square size={12} strokeWidth={2} />}
        </button>
        <button
          type="button"
          className="titlebar__ctl titlebar__ctl--close"
          aria-label={t('close')}
          title={t('close')}
          onClick={() => void window.fireeyeaud?.closeWindow()}
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>
    </header>
  );
}
