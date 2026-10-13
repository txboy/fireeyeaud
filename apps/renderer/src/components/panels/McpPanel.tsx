import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Pencil, Plus, Trash2 } from 'lucide-react';
import { ScopeBadge } from '../ScopeBadge';
import { useMcpStore } from '../../store/mcp';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';

export function McpPanel() {
  const { t } = useTranslation('mcp');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');

  const items = useMcpStore((s) => s.items);
  const loading = useMcpStore((s) => s.loading);
  const errorKey = useMcpStore((s) => s.errorKey);
  const load = useMcpStore((s) => s.load);
  const toggle = useMcpStore((s) => s.toggle);
  const remove = useMcpStore((s) => s.remove);
  const openForm = useUiStore((s) => s.openForm);
  const path = useWorkspaceStore((s) => s.path);

  useEffect(() => {
    if (path) void load();
  }, [load, path]);

  if (!path) {
    return (
      <div className="panel-empty">
        <span>{tc('noWorkspace')}</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="button button--sm"
        onClick={() => void openForm('mcp', 'create')}
      >
        <Plus size={12} strokeWidth={2} /> {t('addServer')}
      </button>

      {errorKey && (
        <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
      )}

      {loading && items.length === 0 ? (
        <div className="panel-empty">
          <span>{tc('loading')}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="panel-empty">
          <span>{t('empty')}</span>
        </div>
      ) : (
        items.map((server) => (
          <div key={server.id} className="card">
            <div className="card__row">
              <span
                className="status-dot"
                style={{
                  background: server.enabled ? 'var(--success)' : 'var(--text-3)',
                }}
              />
              <span className="card__name">{server.name}</span>
              <span className="scope-badge">{server.transport}</span>
              <ScopeBadge scope={server.scope} />
              <span className="spacer" />
              <label className="db-col">
                <input
                  type="checkbox"
                  checked={server.enabled}
                  onChange={(e) => void toggle(server.id, server.scope, e.target.checked)}
                />
                <span>{t('enabled')}</span>
              </label>
              <button
                type="button"
                className="icon-btn"
                title={tc('edit')}
                onClick={() =>
                  void openForm('mcp', 'edit', {
                    id: server.id,
                    scope: server.scope,
                    name: server.name,
                  })
                }
              >
                <Pencil size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className="button button--sm button--ghost"
                onClick={() => void remove(server.id, server.scope)}
              >
                <Trash2 size={12} strokeWidth={2} />
              </button>
            </div>
            <span className="card__meta">
              {server.transport === 'stdio'
                ? `${server.command ?? ''} ${(server.args ?? []).join(' ')}`
                : server.url}
            </span>
            {server.permissions?.toolsAllow?.length ? (
              <span className="card__meta">
                {t('tools')}: {server.permissions.toolsAllow.join(', ')}
              </span>
            ) : null}
            {server.apiKeyRef ? (
              <span className="card__meta">{t('keySet')}</span>
            ) : null}
            {server.env && Object.keys(server.env).length ? (
              <span className="card__meta">
                {t('env')}: {Object.keys(server.env).join(', ')}
              </span>
            ) : null}
          </div>
        ))
      )}

      <div className="note">
        <Info size={14} strokeWidth={1.75} />
        <span>{t('stdioHint')}</span>
      </div>
    </>
  );
}
