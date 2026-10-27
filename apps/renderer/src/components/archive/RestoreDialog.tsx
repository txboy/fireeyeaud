import { useEffect, useState } from 'react';
import { Modal, message } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ArchiveHistoryItem } from '@fireeyeaud/shared';
import { restoreArchive } from '../../lib/api';
import { useConfirmStore } from '../../store/confirm';
import { useWorkspaceStore } from '../../store/workspace';
import { errorKeyOf } from '../../lib/errorKey';

/** 从本地归档历史还原到新文件夹。 */
export function RestoreDialog({
  open,
  history,
  onClose,
}: {
  open: boolean;
  history: ArchiveHistoryItem[];
  onClose: () => void;
}) {
  const { t } = useTranslation('archive');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const confirm = useConfirmStore((s) => s.confirm);
  const openPath = useWorkspaceStore((s) => s.openPath);

  const [archiveId, setArchiveId] = useState('');
  const [parent, setParent] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setArchiveId(history[0]?.id ?? '');
    setParent('');
    setName('');
    setBusy(false);
    setErrorKey(null);
  }, [open, history]);

  const choose = async () => {
    const folder = await window.fireeyeaud?.openFolder?.();
    if (folder) setParent(folder);
  };

  const submit = async () => {
    if (!archiveId || !parent || !name.trim()) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const target = `${parent}/${name.trim()}`;
      const result = await restoreArchive({ archiveId, targetDir: target });
      if (result.warnings.length > 0) {
        void message.warning(result.warnings.join('; '));
      }
      onClose();
      const ok = await confirm({
        title: t('restored'),
        message: t('openAfter'),
        confirmLabel: tc('openFolder'),
        cancelLabel: tc('cancel'),
      });
      if (ok) await openPath(result.target);
    } catch (err) {
      setErrorKey(errorKeyOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('restoreTitle')}
      centered
      width={460}
      onCancel={onClose}
      footer={[
        <button key="cancel" type="button" className="button button--ghost" onClick={onClose}>
          {tc('cancel')}
        </button>,
        <button
          key="ok"
          type="button"
          className="button"
          disabled={busy || !archiveId || !parent || !name.trim()}
          onClick={() => void submit()}
        >
          {t('restore')}
        </button>,
      ]}
    >
      <div className="artifact-form">
        <label className="field">
          <span className="field__label">{t('history')}</span>
          <select
            className="searchbox"
            value={archiveId}
            onChange={(e) => setArchiveId(e.target.value)}
          >
            {history.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} · {item.createdAt.slice(0, 10)} · {item.message}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{t('parentFolder')}</span>
          <div className="artifact-receipt__actions">
            <button type="button" className="button button--sm button--ghost" onClick={() => void choose()}>
              {t('chooseFolder')}
            </button>
            <span className="card__meta">{parent || '—'}</span>
          </div>
        </label>
        <label className="field">
          <span className="field__label">{t('folderName')}</span>
          <input className="searchbox" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {errorKey && (
          <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
        )}
      </div>
    </Modal>
  );
}