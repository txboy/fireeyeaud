import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataSourceInfo } from '@fireeyeaud/shared';
import {
  ChevronDown,
  ChevronRight,
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
import { useDatabaseStore } from '../../store/database';
import { useChatStore } from '../../store/chat';
import { useUiStore, type SessionTab } from '../../store/ui';
import { useConfirmStore } from '../../store/confirm';
import { useAttachDbStore } from '../../store/attachDb';
import { dbDriverFor, normalizePath } from '../../lib/db-file';
import { confirmStopSession } from '../../lib/stop-guard';
import { FileTree } from '../FileTree';

/** 数据源列表折叠状态（面板切换会卸载，故用 localStorage 记忆）。 */
const DATASOURCES_OPEN_KEY = 'fireeyeaud.datasourcesOpen';

function loadDatasourcesOpen(): boolean {
  try {
    return localStorage.getItem(DATASOURCES_OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

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
  const syncing = useDatasourcesStore((s) => s.syncing);
  const syncingFull = useDatasourcesStore((s) => s.syncingFull);
  const importError = useDatasourcesStore((s) => s.errorKey);
  const load = useDatasourcesStore((s) => s.load);
  const importPath = useDatasourcesStore((s) => s.importPath);
  const sync = useDatasourcesStore((s) => s.sync);
  const removeDatasource = useDatasourcesStore((s) => s.remove);

  const sessions = useChatStore((s) => s.sessions);
  const createSession = useChatStore((s) => s.createSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  const [refreshKey, setRefreshKey] = useState(0);
  const [datasourcesOpen, setDatasourcesOpen] = useState(loadDatasourcesOpen);
  const fsRevision = useWorkspaceStore((s) => s.fsRevision);
  const fsRevisionRef = useRef(fsRevision);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedDir, setSelectedDir] = useState<string>('');
  const openSession = useUiStore((s) => s.openSession);
  const rightTabs = useUiStore((s) => s.rightTabs);
  const activeRightTabId = useUiStore((s) => s.activeRightTabId);
  const closeRightTab = useUiStore((s) => s.closeRightTab);
  const confirm = useConfirmStore((s) => s.confirm);
  const openPreview = useUiStore((s) => s.openPreview);
  const openDbSchema = useUiStore((s) => s.openDbSchema);
  const createReturning = useDatabaseStore((s) => s.createReturning);
  const promptAttach = useAttachDbStore((s) => s.promptAttach);
  const [attaching, setAttaching] = useState(false);
  const attachingRef = useRef(false);

  const activeSessionTab = rightTabs.find(
    (tab): tab is SessionTab => tab.kind === 'session' && tab.id === activeRightTabId,
  );
  const activeSessionId = activeSessionTab?.sessionId ?? null;

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
    if (syncing) return;
    setActionError(null);
    setRefreshKey((key) => key + 1);
    // 刷新语义：忽略指纹缓存，重新解析并覆盖全部表格文件。
    void sync({ full: true });
  };

  const toggleDatasources = () => {
    const next = !datasourcesOpen;
    setDatasourcesOpen(next);
    try {
      localStorage.setItem(DATASOURCES_OPEN_KEY, next ? '1' : '0');
    } catch {
      /* 忽略写入失败（隐私模式等） */
    }
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
    if (syncing) return;
    setActionError(null);
    void importPath(target);
  };

  // 点击数据库文件：已附加则直接打开其授权页，否则弹窗确认附加后打开授权页。
  const handleOpenDatabase = useCallback(
    async (filePath: string, name: string) => {
      const driver = dbDriverFor(name);
      if (!driver || attachingRef.current) return;
      setActionError(null);
      attachingRef.current = true;
      try {
        await useDatabaseStore.getState().load();
        const target = normalizePath(filePath);
        const existing = useDatabaseStore
          .getState()
          .items.find((conn) => conn.path && normalizePath(conn.path) === target);
        if (existing) {
          await openDbSchema({ id: existing.id, scope: existing.scope, name: existing.name });
          return;
        }
        const choice = await promptAttach({
          title: t('attachDbTitle'),
          message: t('attachDbMessage', { name }),
          scopeLabel: t('attachDbScope'),
          confirmLabel: t('attachDbConfirm'),
          cancelLabel: tc('cancel'),
          defaultScope: 'project',
        });
        if (!choice) return;
        setAttaching(true);
        const created = await createReturning({
          name,
          driver,
          scope: choice.scope,
          path: filePath,
        });
        if (!created) {
          setActionError(useDatabaseStore.getState().errorKey ?? 'error.internal');
          return;
        }
        await openDbSchema({ id: created.id, scope: created.scope, name: created.name });
      } finally {
        attachingRef.current = false;
        setAttaching(false);
      }
    },
    [openDbSchema, promptAttach, createReturning, t, tc],
  );

  // 点击数据源：文件型在右侧打开原始文件预览；数据库型打开其表结构 / 授权 tab。
  const handleOpenDatasource = async (ds: DataSourceInfo) => {
    if (!path) return;
    if (ds.type === 'db') {
      if (!ds.connectionId) return;
      const store = useDatabaseStore.getState();
      let conn = store.items.find((item) => item.id === ds.connectionId);
      if (!conn) {
        await store.load();
        conn = useDatabaseStore
          .getState()
          .items.find((item) => item.id === ds.connectionId);
      }
      if (conn) {
        await openDbSchema({ id: conn.id, scope: conn.scope, name: conn.name });
      }
      return;
    }
    if (ds.path) {
      const name = ds.path.split(/[\\/]/).pop() ?? ds.id;
      await openPreview(path, ds.path, name);
    }
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

  // 新建会话：创建后立即打开其右侧 tab。
  const handleNewSession = async () => {
    const id = await createSession();
    if (id) await openSession(id);
  };

  // 删除会话：若正在生成先警告并中止；关其 tab；若无会话 tab 则打开剩余最近一条。
  const handleDeleteSession = async (id: string) => {
    if (!(await confirmStopSession(id))) return;
    await deleteSession(id);
    const tabId = `session:${id}`;
    if (useUiStore.getState().rightTabs.some((tab) => tab.id === tabId)) {
      await closeRightTab(tabId);
    }
    const remaining = useUiStore
      .getState()
      .rightTabs.filter((tab) => tab.kind === 'session');
    if (remaining.length === 0) {
      const list = useChatStore.getState().sessions;
      const last = list[list.length - 1];
      if (last) await openSession(last.id);
    }
  };

  // 打开/切换工作区时只做左侧本地初始化；工作区生命周期（清空右区、自动开会话）
  // 由 App 统一处理，避免左侧面板挂载/切换视图时误动右侧区域。
  useEffect(() => {
    if (!path) return;
    setSelectedDir(path);
    void load();
  }, [path, load]);

  // 外部文件变化（fsRevision 自增）→ 刷新文件树。
  useEffect(() => {
    if (fsRevisionRef.current === fsRevision) return;
    fsRevisionRef.current = fsRevision;
    setRefreshKey((key) => key + 1);
  }, [fsRevision]);

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
            onClick={() => void handleNewSession()}
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
                onClick={() => void openSession(session.id)}
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
                    void handleDeleteSession(session.id);
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
            disabled={syncing}
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

          {attaching && <span className="panel-hint">{t('attachDbBusy')}</span>}

          {syncing && (
            <span className="panel-hint">
              {syncingFull ? t('reimporting') : t('syncing')}
            </span>
          )}

          {items.length > 0 && (
            <div className="datasource-group">
              <button
                type="button"
                className="datasource-group__head"
                aria-expanded={datasourcesOpen}
                aria-controls="datasource-list"
                title={datasourcesOpen ? t('collapseDataSources') : t('expandDataSources')}
                onClick={toggleDatasources}
              >
                {datasourcesOpen ? (
                  <ChevronDown size={13} strokeWidth={2} />
                ) : (
                  <ChevronRight size={13} strokeWidth={2} />
                )}
                <span>{t('dataSources')}</span>
                <span className="datasource-group__count">{items.length}</span>
              </button>
              {datasourcesOpen && (
                <div className="datasource-list" id="datasource-list">
                  {items.map((ds) => (
                    <div
                      key={ds.id}
                      className="datasource-chip datasource-chip--clickable"
                      title={ds.path ?? ds.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${t('previewDatasource')}: ${
                        ds.path ? ds.path.split(/[\\/]/).pop() : ds.id
                      }`}
                      onClick={() => void handleOpenDatasource(ds)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void handleOpenDatasource(ds);
                        }
                      }}
                    >
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
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteDatasource(
                            ds.id,
                            ds.path ? ds.path.split(/[\\/]/).pop() ?? ds.id : ds.id,
                          );
                        }}
                      >
                        <Trash2 size={12} strokeWidth={1.75} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
            onOpenDatabase={handleOpenDatabase}
            onUpload={() => void handleUpload()}
          />
        </div>
      </section>
    </div>
  );
}
