import { useEffect, useState } from 'react';
import { Modal, message } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ArchiveStatus } from '@fireeyeaud/shared';
import { patchSettings } from '../../lib/api';
import { useArchiveStore } from '../../store/archive';

/** 远程仓库与归档作者设置。 */
export function ArchiveSettingsDialog({
  open,
  status,
  onClose,
}: {
  open: boolean;
  status: ArchiveStatus | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('archive');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const saveRemote = useArchiveStore((s) => s.saveRemote);

  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [autoPush, setAutoPush] = useState(false);
  const [authorName, setAuthorName] = useState('');
  const [authorEmail, setAuthorEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUrl(status?.remote.remoteUrl ?? '');
    setUsername(status?.remote.username ?? '');
    setToken('');
    setAutoPush(Boolean(status?.remote.autoPush));
    setAuthorName(status?.author.name ?? '');
    setAuthorEmail(status?.author.email ?? '');
    setErrorKey(null);
    setBusy(false);
  }, [open, status]);

  const submit = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      let credRef = status?.remote.credRef ?? null;
      if (token.trim() && window.fireeyeaud?.putSecret) {
        credRef = (await window.fireeyeaud.putSecret(token.trim())) ?? credRef;
      }
      await saveRemote({ url: url.trim(), username: username.trim(), credRef, autoPush });
      await patchSettings({
        archive: { authorName: authorName.trim(), authorEmail: authorEmail.trim() },
      });
      void message.success(t('remoteSaved'));
      onClose();
    } catch (err) {
      setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('settings')}
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
          disabled={busy}
          onClick={() => void submit()}
        >
          {t('save')}
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
            placeholder={t('tokenKeep')}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">{t('authorName')}</span>
          <input
            className="searchbox"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">{t('authorEmail')}</span>
          <input
            className="searchbox"
            value={authorEmail}
            onChange={(e) => setAuthorEmail(e.target.value)}
          />
        </label>
        <label className="artifact-select__item">
          <input
            type="checkbox"
            checked={autoPush}
            onChange={(e) => setAutoPush(e.target.checked)}
          />
          {t('autoPush')}
        </label>
        {errorKey && (
          <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
        )}
      </div>
    </Modal>
  );
}