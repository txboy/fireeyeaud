import { useEffect, useRef } from 'react';
import { Button, notification } from 'antd';
import { useTranslation } from 'react-i18next';
import { useUpdatesStore } from '../store/updates';

/**
 * 发现新版本 / 下载完成时弹非模态通知；同一版本只提示一次。
 * 关闭通知不会中断下载，状态仍可在设置与状态栏查看。
 */
export function UpdateNotifier() {
  const { t } = useTranslation('settings');
  const phase = useUpdatesStore((s) => s.phase);
  const version = useUpdatesStore((s) => s.availableVersion);
  const download = useUpdatesStore((s) => s.download);
  const install = useUpdatesStore((s) => s.install);
  const last = useRef('');
  const availableKey = useRef<string | null>(null);
  const readyKey = useRef<string | null>(null);

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
          btn: (
            <Button
              type="primary"
              size="small"
              onClick={() => {
                notification.destroy(key);
                availableKey.current = null;
                void download();
              }}
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
          btn: (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                type="primary"
                size="small"
                onClick={() => {
                  notification.destroy(key);
                  readyKey.current = null;
                  void install();
                }}
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
  }, [phase, version, download, install, t]);

  // 卸载时清理尚未关闭的通知，避免残留。
  useEffect(
    () => () => {
      if (availableKey.current) notification.destroy(availableKey.current);
      if (readyKey.current) notification.destroy(readyKey.current);
    },
    [],
  );

  return null;
}
