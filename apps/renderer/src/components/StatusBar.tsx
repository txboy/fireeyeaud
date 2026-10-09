import { useTranslation } from 'react-i18next';
import type { SidecarStatus } from '@fireeyeaud/shared';
import { useSidecarStore } from '../store/sidecar';

const STATUS_KEY: Record<SidecarStatus, string> = {
  running: 'statusRunning',
  starting: 'statusStarting',
  stopped: 'statusStopped',
  failed: 'statusFailed',
};

export function StatusBar() {
  const { t } = useTranslation('common');
  const info = useSidecarStore((s) => s.info);
  const status: SidecarStatus = info?.status ?? 'starting';

  return (
    <footer className="statusbar">
      <span className="statusbar__item">
        <span className={`statusbar__dot statusbar__dot--${status}`} />
        {t(STATUS_KEY[status])}
      </span>
      <span className="statusbar__item">{t('noWorkspace')}</span>
      <span className="spacer" />
      <span className="statusbar__item">
        {t('findings')}: 0
      </span>
      <span className="statusbar__item">{t('engine')}: DuckDB</span>
      <span className="statusbar__item">
        {t('model')}: {t('notConfigured')}
      </span>
      <span className="statusbar__item">
        {t('version')}: {info?.health?.appVersion ?? '0.0.0'}
      </span>
    </footer>
  );
}
