import { useTranslation } from 'react-i18next';
import type { SidecarStatus } from '@fireeyeaud/shared';
import { useSidecarStore } from '../store/sidecar';

const STATUS_KEY: Record<SidecarStatus, string> = {
  running: 'statusRunning',
  starting: 'statusStarting',
  stopped: 'statusStopped',
  failed: 'statusFailed',
};

export function TitleBar() {
  const { t } = useTranslation('common');
  const info = useSidecarStore((s) => s.info);
  const status: SidecarStatus = info?.status ?? 'starting';

  return (
    <header className="titlebar">
      <span className="titlebar__flame" />
      <span className="titlebar__brand">{t('appName')}</span>
      <span className="titlebar__project">{t('noWorkspace')}</span>
      <span className="titlebar__spacer" />
      <span className={`titlebar__status titlebar__status--${status}`}>
        {info?.port ? `${t(STATUS_KEY[status])} · 127.0.0.1:${info.port}` : t(STATUS_KEY[status])}
      </span>
    </header>
  );
}
