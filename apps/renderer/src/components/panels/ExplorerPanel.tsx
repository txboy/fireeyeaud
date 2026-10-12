import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Database,
  FolderOpen,
  MessageSquare,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspace';
import { useDatasourcesStore } from '../../store/datasources';
import { useChatStore } from '../../store/chat';
import { useUiStore } from '../../store/ui';
import { useConfirmStore } from '../../store/confirm';
import { FileTree } from '../FileTree';

export function ExplorerPanel() {
  const { t } = useTranslation('explorer');
  const { t: tc } = useTranslation('common');
  const { t: te } = useTranslation('error');
  const { t: ti } = useTranslation('import');
  const workspace = useWorkspaceStore((s) => s.workspace);
  const path = useWorkspaceStore((s) => s.path);
  const loading = useWorkspaceStore((s) => s.loading);
  const error = useWorkspaceStore((s) => s.error);
  const openFromDialog = useWorkspaceStore((s) => s.openFromDialog);

  const items = useDatasourcesStore((s) => s.items);
  const importing = useDatasourcesStore((s) => s.importing);
  const importError = useDatasourcesStore((s) => s.errorKey);
  const load = useDatasourcesStore((s) => s.load);
  const importPath = useDatasourcesStore((s) => s.importPath);
  const removeDatasource = useDatasourcesStore((s) => s.remove);

  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.sessionId);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const selectSession = useChatStore((s) => s.selectSession);
  const newSession = useChatStore((s) => s.newSession);
  const createSession = useChatStore((s) => s.createSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  const [refreshKey, setRefreshKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedDir, setSelectedDir] = useState<string>('');
  const resetRightTabs = useUiStore((s) => s.resetRightTabs);
  const showSession = useUiStore((s) => s.showSession);
  const rightTabs = useUiStore((s) => s.rightTabs);
  const closeRightTab = useUiStore((s) => s.closeRightTab);
  const confirm = useConfirmStore((s) => s.confirm);

  // 删除文件/文件夹后：刷新文件树，并关闭指向被删路径（或其子路径）的预览 tab。
  const handleDeleted = useCallback(
    (deletedPath: string) => {
      setActionError(null);
      setRefreshKey((key) => key + 1);
      const prefixes = [deletedPath + '\\', deletedPath + '/'];
      rightTabs
        .filter(
          (tab) =>
            tab.kind === 'preview' &&
            (tab.path === deletedPath ||
              prefixes.some((prefix) => tab.path.startsWith(prefix))),
        )
        .forEach((tab) => void closeRightTab(tab.id));
    },
    [rightTabs, closeRightTab],
  );

  const handleRefresh = () => {
    setActionError(null);
    setRefreshKey((key) => key + 1);
  };

  // 上传文件：仅把文件复制进工作区（不导入数据源）。
  const handleUpload = async () => {
    if (!path) return;
    const files = (await window.fireeyeaud?.openFiles('all')) ?? [];
    if (files.length === 0) return;
    setActionError(null);
    const res = await window.fireeyeaud?.copyFiles({
      root: path,
      targetDir: selectedDir || path,
      sourcePaths: files,
    });
    if (res?.ok) setRefreshKey((key) => key + 1);
    else setActionError('error.opFailed');
  };

  const handleImportData = (target: string) => {
    setActionError(null);
    void importPath(target);
  };

  const handleDeleteDatasource = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: t('delete'),
      message: t('deleteDataSourceConfirm', { name }),
      confirmLabel: t('delete'),
      cancelLabel: tc('cancel'),
      danger: true,
    });
    if (!confirmed) return;
    setActionError(null);
    await removeDatasource(id);
  };

  // 切换工作区时刷新数据源 / 会话，并重置当前对话与右侧 tab。
  useEffect(() => {
    if (!path) return;
    setSelectedDir(path);
    void load();
    newSession();
    void loadSessions();
    resetRightTabs();
  }, [path, load, newSession, loadSessions, resetRightTabs]);

  if (!workspace || !path) {
    return (
      <div className="panel-empty">
        <FolderOpen size={22} strokeWidth={1.5} />
        <span>{t('openFolderHint')}</span>
        <button
          type="button"
          className="button"
          onClick={() => void openFromDialog()}
          disabled={loading}
        >
          {loading ? tc('loading') : tc('openFolder')}
        </button>
        {error && (
          <span className="panel-error">
            {te((error.messageKey ?? 'error.internal').replace(/^error\./, ''))}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="explorer">
      <section className="explorer__section explorer__section--sessions">
        <div className="section-head">
          <span>{t('sessions')}</span>
          <span className="spacer" />
          <button
            type="button"
            className="icon-button"
            title={t('newSession')}
            aria-label={t('newSession')}
            onClick={() => {
              void createSession();
              showSession();
            }}
          >
            <Plus size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="session-list">
          {sessions.length === 0 ? (
            <span className="panel-hint">{t('noSessions')}</span>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={`session${session.id === activeSessionId ? ' session--active' : ''}`}
                onClick={() => {
                  void selectSession(session.id);
                  showSession();
                }}
                title={session.title ?? t('untitledSession')}
              >
                <MessageSquare size={13} strokeWidth={1.75} />
                <span className="session__title">
                  {session.title || t('untitledSession')}
                </span>
                <button
                  type="button"
                  className="session__del"
                  title={t('deleteSession')}
                  aria-label={t('deleteSession')}
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteSession(session.id);
                  }}
                >
                  <Trash2 size={13} strokeWidth={1.75} />
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="explorer__section explorer__section--files">
        <div className="section-head">
          <span>{t('files')}</span>
          <span className="spacer" />
          <button
            type="button"
            className="icon-button"
            title={t('upload')}
            aria-label={t('upload')}
            onClick={() => void handleUpload()}
          >
            <Upload size={14} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('refresh')}
            aria-label={t('refresh')}
            onClick={handleRefresh}
          >
            <RefreshCw size={14} strokeWidth={1.9} />
          </button>
        </div>

        <div className="explorer__files-body">
          {importing && (
            <div className="import-progress">
              <div className="import-progress__head">
                <span className="import-progress__name">
                  {importing.path.split(/[\\/]/).pop()}
                </span>
                <span className="import-progress__phase">
                  {ti(
                    importing.phase === 'parse'
                      ? 'parsing'
                      : importing.phase === 'index'
                        ? 'indexing'
                        : 'loading',
                  )}
                </span>
              </div>
              <div className="progress">
                <div
                  className="progress__bar"
                  style={{
                    width: `${
                      importing.total > 0
                        ? Math.round((importing.done / importing.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {importError && (
            <span className="panel-error">{te(importError.replace(/^error\./, ''))}</span>
          )}

          {actionError && (
            <span className="panel-error">{te(actionError.replace(/^error\./, ''))}</span>
          )}

          {items.length > 0 && (
            <div className="datasource-list">
              {items.map((ds) => (
                <div key={ds.id} className="datasource-chip" title={ds.path ?? ds.id}>
                  <Database size={12} strokeWidth={1.75} />
                  <span className="datasource-chip__name">
                    {ds.path ? ds.path.split(/[\\/]/).pop() : ds.id}
                  </span>
                  <span className="datasource-chip__meta">
                    {ti('tables', { count: ds.tables.length })}
                  </span>
                  <button
                    type="button"
                    className="datasource-chip__del"
                    title={t('delete')}
                    aria-label={t('delete')}
                    onClick={() =>
                      void handleDeleteDatasource(
                        ds.id,
                        ds.path ? ds.path.split(/[\\/]/).pop() ?? ds.id : ds.id,
                      )
                    }
                  >
                    <Trash2 size={12} strokeWidth={1.75} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <FileTree
            root={path}
            refreshKey={refreshKey}
            selectedDir={selectedDir}
            onSelectDir={setSelectedDir}
            onRefresh={handleRefresh}
            onDeleted={handleDeleted}
            onError={setActionError}
            onImportData={handleImportData}
            onUpload={() => void handleUpload()}
          />
        </div>
      </section>
    </div>
  );
}
