import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SidecarStatus } from '@fireeyeaud/shared';
import { useSidecarStore } from '../store/sidecar';
import { useWorkspaceStore } from '../store/workspace';
import { useModelsStore } from '../store/models';
import { useDatasourcesStore } from '../store/datasources';
import { useUpdatesStore } from '../store/updates';
import { useUiStore } from '../store/ui';

const STATUS_KEY: Record<SidecarStatus, string> = {
  running: 'statusRunning',
  starting: 'statusStarting',
  stopped: 'statusStopped',
  failed: 'statusFailed',
};

export function StatusBar() {
  const { t } = useTranslation('common');
  // 更新相关的文案在 settings 命名空间。
  const { t: tSettings } = useTranslation('settings');
  const info = useSidecarStore((s) => s.info);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const path = useWorkspaceStore((s) => s.path);
  const models = useModelsStore((s) => s.items);
  const loadModels = useModelsStore((s) => s.load);
  const backgroundSync = useDatasourcesStore((s) => s.backgroundSync);
  const updatePhase = useUpdatesStore((s) => s.phase);
  const availableVersion = useUpdatesStore((s) => s.availableVersion);
  const openSettings = useUiStore((s) => s.openSettings);
  const status: SidecarStatus = info?.status ?? 'starting';

  // sidecar 就绪后加载模型配置（与上下文栏同一数据源）。
  useEffect(() => {
    if (status === 'running') void loadModels();
  }, [status, loadModels]);

  // 当前生效模型：默认（isDefault）否则首个；与后端解析规则一致。
  const model = models.find((m) => m.isDefault) ?? models[0];
  const year = new Date().getFullYear();

  return (
    <footer className="statusbar">
      <div className="statusbar__group statusbar__group--left">
        <span className="statusbar__item">
          <span className={`statusbar__dot statusbar__dot--${status}`} />
          {t(STATUS_KEY[status])}
        </span>
        <span className="statusbar__item statusbar__item--path">
          {workspace ? path : t('noWorkspace')}
        </span>
        {backgroundSync && (
          <span className="statusbar__item statusbar__item--busy" role="status">
            <span className="statusbar__dot statusbar__dot--starting" />
            {t('preparingData')}
            {backgroundSync.total > 0
              ? ` ${backgroundSync.done}/${backgroundSync.total}`
              : ''}
          </span>
        )}
      </div>

      <span className="statusbar__brand">{t('copyright', { year })}</span>

      <div className="statusbar__group statusbar__group--right">
        <span className="statusbar__item">
          {t('findings')}: {workspace?.counters?.finding ?? 0}
        </span>
        <span className="statusbar__item">{t('engine')}: DuckDB</span>
        <span
          className="statusbar__item"
          title={model ? `${model.model} · ${model.baseUrl}` : undefined}
        >
          {t('model')}: {model ? model.name : t('notConfigured')}
        </span>
        {(updatePhase === 'available' || updatePhase === 'downloaded') && (
          <button
            type="button"
            className="statusbar__item statusbar__item--update"
            title={tSettings('updateOpenSettings')}
            aria-live="polite"
            onClick={() => {
              void openSettings().then(() => {
                // 设置 tab 由 state 驱动挂载，等两帧确保面板已提交再滚动/聚焦。
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    const section = document.getElementById('settings-update');
                    section?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    section?.querySelector<HTMLElement>('button, input')?.focus();
                  });
                });
              });
            }}
          >
            {updatePhase === 'downloaded'
              ? tSettings('updateReadyBadge')
              : tSettings('updateAvailableBadge', { version: availableVersion ?? '—' })}
          </button>
        )}
        <span className="statusbar__item">
          {t('version')}: {info?.health?.appVersion ?? '0.0.0'}
        </span>
      </div>
    </footer>
  );
}
