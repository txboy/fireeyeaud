import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConfigScope, McpServer, McpTransport } from '@fireeyeaud/shared';
import { useMcpStore } from '../../store/mcp';
import { FormActions } from './FormActions';
import { FormError } from './FormError';
import { useUnsavedGuard } from './UnsavedGuard';

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
  isDefault: boolean;
}

const EMPTY: FormState = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  scope: 'project',
  fsScope: 'workspace',
  net: false,
  toolsAllow: '',
  isDefault: false,
};

function init(entity?: McpServer): FormState {
  if (!entity) return EMPTY;
  return {
    name: entity.name,
    transport: entity.transport,
    command: entity.command ?? '',
    args: (entity.args ?? []).join(' '),
    url: entity.url ?? '',
    scope: entity.scope,
    fsScope: entity.permissions?.fsScope ?? 'workspace',
    net: Boolean(entity.permissions?.net),
    toolsAllow: (entity.permissions?.toolsAllow ?? []).join(' '),
    isDefault: Boolean(entity.isDefault),
  };
}

function parseTokens(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function McpForm({
  entity,
  onSaved,
  onCancel,
}: {
  entity?: McpServer;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('mcp');
  const { t: te } = useTranslation('enums');
  const create = useMcpStore((s) => s.create);
  const edit = useMcpStore((s) => s.edit);
  const errorKey = useMcpStore((s) => s.errorKey);

  const initialRef = useRef<FormState>(init(entity));
  const [form, setForm] = useState<FormState>(initialRef.current);
  const [busy, setBusy] = useState(false);

  const isStdio = form.transport === 'stdio';
  const dirty = JSON.stringify(form) !== JSON.stringify(initialRef.current);

  const save = async (): Promise<boolean> => {
    if (!form.name.trim()) return false;
    setBusy(true);
    const payload = {
      name: form.name.trim(),
      transport: form.transport,
      scope: form.scope,
      command: isStdio ? form.command.trim() || null : null,
      args: isStdio ? parseTokens(form.args) : null,
      url: isStdio ? null : form.url.trim() || null,
      isDefault: form.isDefault,
      permissions: {
        fsScope: form.fsScope,
        net: form.net,
        toolsAllow: parseTokens(form.toolsAllow),
      },
    };
    const ok = entity
      ? await edit(entity.id, entity.scope, payload)
      : await create({ ...payload, enabled: true });
    setBusy(false);
    return ok;
  };

  const { modal, forceLeave } = useUnsavedGuard(dirty, save, entity?.name);

  const close = (cb: () => void) => {
    forceLeave();
    cb();
  };

  return (
    <div className="formtab__form">
      <label className="field">
        <span className="field__label">{t('name')}</span>
        <input
          className="searchbox"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('transport')}</span>
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
      </label>
      {isStdio ? (
        <>
          <label className="field">
            <span className="field__label">{t('command')}</span>
            <input
              className="searchbox"
              value={form.command}
              onChange={(e) => setForm({ ...form, command: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field__label">{t('args')}</span>
            <input
              className="searchbox"
              value={form.args}
              onChange={(e) => setForm({ ...form, args: e.target.value })}
            />
          </label>
        </>
      ) : (
        <label className="field">
          <span className="field__label">{t('url')}</span>
          <input
            className="searchbox"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
        </label>
      )}
      <label className="field">
        <span className="field__label">{t('tools')}</span>
        <input
          className="searchbox"
          value={form.toolsAllow}
          onChange={(e) => setForm({ ...form, toolsAllow: e.target.value })}
        />
      </label>
      <div className="field">
        <span className="field__label">{t('permissions')}</span>
        <div className="search-opts">
          <label className="search-opt">
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
          </label>
          <label className="search-opt">
            <input
              type="checkbox"
              checked={form.net}
              onChange={(e) => setForm({ ...form, net: e.target.checked })}
            />
            <span>{t('net')}</span>
          </label>
          <label className="search-opt">
            <select
              className="searchbox"
              value={form.scope}
              disabled={Boolean(entity)}
              onChange={(e) => setForm({ ...form, scope: e.target.value as ConfigScope })}
            >
              <option value="project">{te('configScope.project')}</option>
              <option value="global">{te('configScope.global')}</option>
            </select>
          </label>
        </div>
      </div>

      <label className="field field--inline">
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
        />
        <span>{t('isDefault')}</span>
      </label>

      <span className="card__meta">{t('stdioHint')}</span>
      <FormError errorKey={errorKey} />
      <FormActions
        onSave={() => void save().then((ok) => ok && close(onSaved))}
        onCancel={() => close(onCancel)}
        busy={busy}
        create={!entity}
        disabled={!form.name.trim()}
      />
      {modal}
    </div>
  );
}
