import { useTranslation } from 'react-i18next';
import type { SidecarStatus } from '@fireeyeaud/shared';
import { FolderOpen } from 'lucide-react';
import { useSidecarStore } from '../store/sidecar';
import { useWorkspaceStore } from '../store/workspace';

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
  const openFromDialog = useWorkspaceStore((s) => s.openFromDialog);
  const status: SidecarStatus = info?.status ?? 'starting';

  return (
    <header className="titlebar">
      <span className="titlebar__flame" />
      <span className="titlebar__brand">{t('appName')}</span>
      <span className="titlebar__project">
        {workspace ? workspace.name : t('noWorkspace')}
      </span>
      <span className="titlebar__spacer" />
      {!workspace && (
        <button type="button" className="titlebar__btn" onClick={() => void openFromDialog()}>
          <FolderOpen size={13} strokeWidth={1.9} />
          {t('openFolder')}
        </button>
      )}
      <span className={`titlebar__status titlebar__status--${status}`}>
        {info?.port ? `${t(STATUS_KEY[status])} · 127.0.0.1:${info.port}` : t(STATUS_KEY[status])}
      </span>
    </header>
  );
}
