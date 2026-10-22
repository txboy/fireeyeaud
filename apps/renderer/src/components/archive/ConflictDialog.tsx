import { useEffect, useMemo, useState } from 'react';
import { Modal, Radio } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ArchiveConflictCheck } from '@fireeyeaud/shared';
import { useArchiveStore } from '../../store/archive';

type Choice = 'local' | 'remote' | 'both' | 'auto';

/** 分叉解决：按文件选择本地 / 远程 / 两份都留（findings.jsonl 可自动合并）。 */
export function ConflictDialog({
  check,
  onClose,
  onResolved,
}: {
  check: ArchiveConflictCheck | null;
  onClose: () => void;
  onResolved: () => void;
}) {
  const { t } = useTranslation('archive');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const resolve = useArchiveStore((s) => s.resolve);

  const [base, setBase] = useState<'local' | 'remote'>('local');
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const conflicts = useMemo(() => check?.conflicts ?? [], [check]);

  useEffect(() => {
    if (!check) return;
    setBase('local');
    setErrorKey(null);
    setBusy(false);
    setChoices(
      Object.fromEntries(
        conflicts.map((item) => [item.path, item.autoMerge ? 'auto' : 'local']),
      ),
    );
  }, [check, conflicts]);

  const submit = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      await resolve({
        base,
        choices,
        message: `合并归档 ${new Date().toISOString().slice(0, 10)}`,
      });
      onResolved();
      onClose();
    } catch (err) {
      setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={check !== null}
      title={t('conflictTitle')}
      centered
      width={720}
      onCancel={onClose}
      footer={[
        <button key="cancel" type="button" className="button button--ghost" onClick={onClose}>
          {tc('cancel')}
        </button>,
        <button
          key="ok"
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void submit()}
        >
          {t('resolve')}
        </button>,
      ]}
    >
      <div className="artifact-form">
        <Radio.Group value={base} onChange={(e) => setBase(e.target.value as 'local' | 'remote')}>
          <Radio value="local">{t('baseLocal')}</Radio>
          <Radio value="remote">{t('baseRemote')}</Radio>
        </Radio.Group>

        {conflicts.length === 0 ? (
          <div className="panel-empty">
            <span>{t('noConflict')}</span>
          </div>
        ) : (
          <div className="conflict-list">
            {conflicts.map((item) => (
              <div key={item.path} className="conflict-row">
                <div className="conflict-row__main">
                  <span className="artifact-row__title">{item.path}</span>
                  <span className="card__meta">
                    {t('local')}: {item.localStatus} · {t('remoteVersion')}:{' '}
                    {item.remoteStatus}
                  </span>
                  {item.hint && <span className="card__meta">{t('evidenceWarning')}</span>}
                </div>
                <select
                  className="searchbox"
                  value={choices[item.path] ?? 'local'}
                  onChange={(e) =>
                    setChoices((prev) => ({
                      ...prev,
                      [item.path]: e.target.value as Choice,
                    }))
                  }
                >
                  <option value="local">{t('local')}</option>
                  <option value="remote">{t('remoteVersion')}</option>
                  <option value="both">{t('both')}</option>
                  {item.autoMerge && <option value="auto">{t('auto')}</option>}
                </select>
              </div>
            ))}
          </div>
        )}

        {check && (check.remoteOnly.length > 0 || check.localOnly.length > 0) && (
          <div className="card__meta">
            {t('remoteVersion')} +{check.remoteOnly.length} · {t('local')} +
            {check.localOnly.length}
          </div>
        )}

        {errorKey && (
          <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
        )}
      </div>
    </Modal>
  );
}