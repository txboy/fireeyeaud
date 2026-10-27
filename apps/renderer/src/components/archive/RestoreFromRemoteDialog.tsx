import { useEffect, useState } from 'react';
import { Modal, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { cloneArchive } from '../../lib/api';
import { useConfirmStore } from '../../store/confirm';
import { useWorkspaceStore } from '../../store/workspace';
import { errorKeyOf } from '../../lib/errorKey';

/** 欢迎页：从远程 clone 一个审计项目到本地。 */
export function RestoreFromRemoteDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('archive');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const confirm = useConfirmStore((s) => s.confirm);
  const openPath = useWorkspaceStore((s) => s.openPath);

  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [parent, setParent] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUrl('');
    setUsername('');
    setToken('');
    setParent('');
    setName('');
    setBusy(false);
    setErrorKey(null);
  }, [open]);

  const choose = async () => {
    const folder = await window.fireeyeaud?.openFolder?.();
    if (folder) setParent(folder);
  };

  const submit = async () => {
    if (!url.trim() || !parent || !name.trim()) return;
    setBusy(true);
    setErrorKey(null);
    try {
      let credRef: string | null = null;
      if (token.trim() && window.fireeyeaud?.putSecret) {
        credRef = await window.fireeyeaud.putSecret(token.trim());
      }
      const target = `${parent}/${name.trim()}`;
      const result = await cloneArchive({
        url: url.trim(),
        targetDir: target,
        username: username.trim(),
        credRef,
      });
      if (result.warnings.length > 0) {
        void message.warning(result.warnings.join('; '));
      }
      onClose();
      const ok = await confirm({
        title: t('cloned'),
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
      title={t('fromRemoteTitle')}
      centered
      width={480}
      onCancel={onClose}
      footer={[
        <button key="cancel" type="button" className="button button--ghost" onClick={onClose}>
          {tc('cancel')}
        </button>,
        <button
          key="ok"
          type="button"
          className="button"
          disabled={busy || !url.trim() || !parent || !name.trim()}
          onClick={() => void submit()}
        >
          {t('fromRemote')}
        </button>,
      ]}
    >
      <div className="artifact-form">
        <label className="field">
          <span className="field__label">{t('url')}</span>
          <input className="searchbox" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">{t('username')}</span>
          <input
            className="searchbox"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">{t('token')}</span>
          <input
            className="searchbox"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
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