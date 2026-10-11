import { useEffect, useState } from 'react';
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
  const importFiles = useDatasourcesStore((s) => s.importFiles);

  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.sessionId);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const selectSession = useChatStore((s) => s.selectSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  const [refreshKey, setRefreshKey] = useState(0);

  // 切换工作区时刷新数据源 / 会话，并重置当前对话。
  useEffect(() => {
    if (!path) return;
    void load();
    newSession();
    void loadSessions();
  }, [path, load, newSession, loadSessions]);

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
        {error && <span className="panel-error">{te(error.messageKey.replace(/^error\./, ''))}</span>}
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
            onClick={newSession}
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
                onClick={() => void selectSession(session.id)}
                title={session.title ?? session.id}
              >
                <MessageSquare size={13} strokeWidth={1.75} />
                <span className="session__title">{session.title || session.id}</span>
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
            title={ti('button')}
            aria-label={ti('button')}
            onClick={() => void importFiles()}
            disabled={Boolean(importing)}
          >
            <Upload size={14} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('refresh')}
            aria-label={t('refresh')}
            onClick={() => setRefreshKey((key) => key + 1)}
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
                </div>
              ))}
            </div>
          )}

          <FileTree root={path} refreshKey={refreshKey} />
        </div>
      </section>
    </div>
  );
}
