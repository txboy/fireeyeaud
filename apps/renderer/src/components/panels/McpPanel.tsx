import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Plus, Trash2 } from 'lucide-react';
import type { ConfigScope, McpTransport } from '@fireeyeaud/shared';
import { ScopeBadge } from '../ScopeBadge';
import { useMcpStore } from '../../store/mcp';
import { useWorkspaceStore } from '../../store/workspace';

const TRANSPORTS: McpTransport[] = ['stdio', 'sse', 'http'];

interface FormState {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  url: string;
  scope: ConfigScope;
  fsScope: 'workspace' | 'none';
  net: boolean;
  toolsAllow: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  scope: 'project',
  fsScope: 'workspace',
  net: false,
  toolsAllow: '',
};

function parseTokens(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function McpPanel() {
  const { t } = useTranslation('mcp');
  const { t: te } = useTranslation('enums');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');

  const items = useMcpStore((s) => s.items);
  const loading = useMcpStore((s) => s.loading);
  const errorKey = useMcpStore((s) => s.errorKey);
  const load = useMcpStore((s) => s.load);
  const create = useMcpStore((s) => s.create);
  const toggle = useMcpStore((s) => s.toggle);
  const remove = useMcpStore((s) => s.remove);
  const path = useWorkspaceStore((s) => s.path);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (path) void load();
  }, [load, path]);

  const isStdio = form.transport === 'stdio';

  const submit = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    const ok = await create({
      name: form.name.trim(),
      transport: form.transport,
      command: isStdio ? form.command.trim() || undefined : undefined,
      args: isStdio ? parseTokens(form.args) : undefined,
      url: isStdio ? undefined : form.url.trim() || undefined,
      enabled: true,
      scope: form.scope,
      permissions: {
        fsScope: form.fsScope,
        net: form.net,
        toolsAllow: parseTokens(form.toolsAllow),
      },
    });
    setBusy(false);
    if (ok) {
      setShowForm(false);
      setForm(EMPTY_FORM);
    }
  };

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
        onClick={() => setShowForm((v) => !v)}
      >
        <Plus size={12} strokeWidth={2} /> {t('addServer')}
      </button>

      {showForm && (
        <div className="card db-form">
          <input
            className="searchbox"
            placeholder={t('name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <select
            className="searchbox"
            value={form.transport}
            onChange={(e) => setForm({ ...form, transport: e.target.value as McpTransport })}
          >
            {TRANSPORTS.map((tr) => (
              <option key={tr} value={tr}>
                {tr}
              </option>
            ))}
          </select>
          {isStdio ? (
            <>
              <input
                className="searchbox"
                placeholder={t('command')}
                value={form.command}
                onChange={(e) => setForm({ ...form, command: e.target.value })}
              />
              <input
                className="searchbox"
                placeholder={t('args')}
                value={form.args}
                onChange={(e) => setForm({ ...form, args: e.target.value })}
              />
            </>
          ) : (
            <input
              className="searchbox"
              placeholder={t('url')}
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          )}
          <input
            className="searchbox"
            placeholder={t('tools')}
            value={form.toolsAllow}
            onChange={(e) => setForm({ ...form, toolsAllow: e.target.value })}
          />
          <div className="card__row">
            <select
              className="searchbox"
              value={form.fsScope}
              onChange={(e) =>
                setForm({ ...form, fsScope: e.target.value as 'workspace' | 'none' })
              }
            >
              <option value="workspace">{t('fsWorkspace')}</option>
              <option value="none">{t('fsNone')}</option>
            </select>
            <label className="db-col">
              <input
                type="checkbox"
                checked={form.net}
                onChange={(e) => setForm({ ...form, net: e.target.checked })}
              />
              <span>{t('net')}</span>
            </label>
            <select
              className="searchbox"
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as ConfigScope })}
            >
              <option value="project">{te('configScope.project')}</option>
              <option value="global">{te('configScope.global')}</option>
            </select>
            <span className="spacer" />
            <button
              type="button"
              className="button button--sm"
              disabled={busy || !form.name.trim()}
              onClick={() => void submit()}
            >
              {t('save')}
            </button>
            <button
              type="button"
              className="button button--sm button--ghost"
              onClick={() => setShowForm(false)}
            >
              {t('cancel')}
            </button>
          </div>
          {isStdio && <span className="card__meta">{t('stdioHint')}</span>}
        </div>
      )}

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
