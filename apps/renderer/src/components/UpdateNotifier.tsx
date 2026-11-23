import { useEffect, useRef } from 'react';
import { App as AntdApp, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useUpdatesStore } from '../store/updates';

/**
 * 发现新版本 / 下载完成时弹非模态通知；同一版本只提示一次。
 * 关闭通知不会中断下载，状态仍可在设置与状态栏查看。
 *
 * 通知 key 是模块级字符串，按渲染进程（单窗口假设）全局唯一；
 * 若将来支持多窗口，需要按窗口加前缀。
 */
export function UpdateNotifier() {
  const { notification } = AntdApp.useApp();
  const { t } = useTranslation('settings');
  const phase = useUpdatesStore((s) => s.phase);
  const version = useUpdatesStore((s) => s.availableVersion);
  const download = useUpdatesStore((s) => s.download);
  const install = useUpdatesStore((s) => s.install);
  const last = useRef('');
  const availableKey = useRef<string | null>(null);
  const readyKey = useRef<string | null>(null);
  // 命令进行中时忽略重复点击；失败时保留通知以便重试。
  const pending = useRef(false);

  const handleDownload = async (key: string) => {
    if (pending.current) return;
    pending.current = true;
    try {
      const result = await download();
      if (result.ok) {
        notification.destroy(key);
        availableKey.current = null;
      } else {
        notification.error({
          message: t('updateActionFailed'),
          duration: 4,
        });
      }
    } finally {
      pending.current = false;
    }
  };

  const handleInstall = async (key: string) => {
    if (pending.current) return;
    pending.current = true;
    try {
      const result = await install();
      if (result.ok) {
        notification.destroy(key);
        readyKey.current = null;
      } else {
        notification.error({
          message: t('updateActionFailed'),
          duration: 4,
        });
      }
    } finally {
      pending.current = false;
    }
  };

  useEffect(() => {
    if (phase === 'available') {
      const key = `update-available-${version ?? 'unknown'}`;
      if (last.current !== `available:${version}`) {
        last.current = `available:${version}`;
        availableKey.current = key;
        notification.info({
          key,
          message: t('updateAvailableTitle', { version: version ?? '—' }),
          description: t('updateAvailableBody'),
          duration: 0,
          actions: (
            <Button
              type="primary"
              size="small"
              onClick={() => void handleDownload(key)}
            >
              {t('updateDownload')}
            </Button>
          ),
        });
      }
    } else if (availableKey.current) {
      notification.destroy(availableKey.current);
      availableKey.current = null;
    }

    if (phase === 'downloaded') {
      const key = `update-ready-${version ?? 'unknown'}`;
      if (last.current !== `downloaded:${version}`) {
        last.current = `downloaded:${version}`;
        readyKey.current = key;
        notification.success({
          key,
          message: t('updateReadyTitle'),
          description: t('updateReadyBody', { version: version ?? '—' }),
          duration: 0,
          actions: (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                type="primary"
                size="small"
                onClick={() => void handleInstall(key)}
              >
                {t('updateRestart')}
              </Button>
              <Button
                size="small"
                onClick={() => {
                  notification.destroy(key);
                  readyKey.current = null;
                }}
              >
                {t('updateLater')}
              </Button>
            </div>
          ),
        });
      }
    } else if (readyKey.current) {
      notification.destroy(readyKey.current);
      readyKey.current = null;
    }
  }, [phase, version, download, install, notification, t]);

  // 卸载时清理尚未关闭的通知；同时复位去重状态，StrictMode/HMR 重挂载后能重新提示。
  useEffect(
    () => () => {
      if (availableKey.current) notification.destroy(availableKey.current);
      if (readyKey.current) notification.destroy(readyKey.current);
      availableKey.current = null;
      readyKey.current = null;
      last.current = '';
    },
    [notification],
  );

  return null;
}
