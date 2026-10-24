import { useEffect, useState } from 'react';
import { message } from 'antd';
import { useTranslation } from 'react-i18next';
import { patchSettings } from '../../lib/api';
import { useArchiveStore } from '../../store/archive';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';

/**
 * 右侧「远程设置」tab：归档远程仓库与操作人配置。
 * 逻辑与原弹窗一致——换地址要重新输入 Token，保存后整页重载状态。
 */
export function ArchiveRemoteTab() {
  const { t } = useTranslation('archive');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const status = useArchiveStore((s) => s.status);
  const load = useArchiveStore((s) => s.load);
  const saveRemote = useArchiveStore((s) => s.saveRemote);
  const closeTab = useUiStore((s) => s.closeRightTab);
  const wsPath = useWorkspaceStore((s) => s.path);

  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [autoPush, setAutoPush] = useState(false);
  const [authorName, setAuthorName] = useState('');
  const [authorEmail, setAuthorEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // 状态由左侧面板与差异 tab 共用，这里只确保已加载，不能 reset。
  useEffect(() => {
    if (!wsPath) return;
    void load();
  }, [load, wsPath]);

  useEffect(() => {
    if (!status) return;
    setUrl(status.remote.remoteUrl ?? '');
    setUsername(status.remote.username ?? '');
    setAutoPush(Boolean(status.remote.autoPush));
    setAuthorName(status.author.name ?? '');
    setAuthorEmail(status.author.email ?? '');
  }, [status]);

  const submit = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      let credRef = status?.remote.credRef ?? null;
      // 换了远程地址就该重新输入 Token，避免把旧站点的凭据发给新站点
      if (url.trim() !== (status?.remote.remoteUrl ?? '')) credRef = null;
      if (token.trim() && window.fireeyeaud?.putSecret) {
        credRef = (await window.fireeyeaud.putSecret(token.trim())) ?? credRef;
      }
      await saveRemote({ url: url.trim(), username: username.trim(), credRef, autoPush });
      await patchSettings({
        archive: { authorName: authorName.trim(), authorEmail: authorEmail.trim() },
      });
      // saveRemote 先刷新了一次状态，作者信息需要再刷新一次
      await useArchiveStore.getState().load();
      setToken('');
      void message.success(t('remoteSaved'));
    } catch (err) {
      setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
    } finally {
      setBusy(false);
    }
  };

  if (!wsPath) {
    return (
      <div className="tab-empty">
        <span>{tc('noWorkspace')}</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="tab-empty">
        <span>{tc('loading')}</span>
      </div>
    );
  }

  return (
    <div className="formtab__form archive-remote">
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
          autoComplete="new-password"
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

      <div className="formtab__actions">
        <span className="spacer" />
        <button
          type="button"
          className="button button--ghost"
          onClick={() => void closeTab('archiveRemote')}
        >
          {tc('cancel')}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void submit()}
        >
          {t('save')}
        </button>
      </div>
    </div>
  );
}