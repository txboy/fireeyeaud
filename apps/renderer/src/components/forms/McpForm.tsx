import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { ConfigScope, McpServer, McpTransport } from '@fireeyeaud/shared';
import { useMcpStore } from '../../store/mcp';
import { FormActions } from './FormActions';
import { FormError } from './FormError';
import { useUnsavedGuard } from './UnsavedGuard';

const TRANSPORTS: McpTransport[] = ['stdio', 'sse', 'http'];

interface EnvRow {
  key: string;
  value: string;
}

interface FormState {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  url: string;
  env: EnvRow[];
  apiKey: string;
  apiKeyEnv: string;
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
  env: [],
  apiKey: '',
  apiKeyEnv: '',
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
    env: Object.entries(entity.env ?? {}).map(([key, value]) => ({ key, value })),
    // 密钥只写不读：编辑时不回填，留空表示保持原密钥。
    apiKey: '',
    apiKeyEnv: entity.apiKeyEnv ?? '',
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

/** 把环境变量行整理为对象（丢弃空变量名）。 */
function parseEnv(rows: EnvRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) out[key] = row.value;
  }
  return out;
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
    let apiKeyRef: string | undefined;
    if (form.apiKey && window.fireeyeaud) {
      apiKeyRef = (await window.fireeyeaud.putSecret(form.apiKey)) ?? undefined;
    }
    const payload = {
      name: form.name.trim(),
      transport: form.transport,
      scope: form.scope,
      command: isStdio ? form.command.trim() || null : null,
      args: isStdio ? parseTokens(form.args) : null,
      url: isStdio ? null : form.url.trim() || null,
      env: parseEnv(form.env),
      apiKeyEnv: form.apiKeyEnv.trim(),
      ...(apiKeyRef ? { apiKeyRef } : {}),
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
          <div className="field">
            <span className="field__label">{t('env')}</span>
            <div className="kv-list">
              {form.env.map((row, i) => (
                <div className="kv-row" key={i}>
                  <input
                    className="searchbox"
                    placeholder={t('envKey')}
                    value={row.key}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        env: form.env.map((r, j) =>
                          j === i ? { ...r, key: e.target.value } : r,
                        ),
                      })
                    }
                  />
                  <input
                    className="searchbox"
                    placeholder={t('envValue')}
                    value={row.value}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        env: form.env.map((r, j) =>
                          j === i ? { ...r, value: e.target.value } : r,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    title={t('delete')}
                    onClick={() =>
                      setForm({ ...form, env: form.env.filter((_, j) => j !== i) })
                    }
                  >
                    <Trash2 size={13} strokeWidth={1.75} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="button button--sm button--ghost"
                onClick={() => setForm({ ...form, env: [...form.env, { key: '', value: '' }] })}
              >
                <Plus size={12} strokeWidth={2} /> {t('envAdd')}
              </button>
            </div>
          </div>
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
        <span className="field__label">{t('apiKey')}</span>
        <input
          className="searchbox"
          type="password"
          placeholder={entity && entity.apiKeyRef ? t('apiKeyKeep') : ''}
          value={form.apiKey}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('apiKeyEnv')}</span>
        <input
          className="searchbox"
          value={form.apiKeyEnv}
          onChange={(e) => setForm({ ...form, apiKeyEnv: e.target.value })}
        />
      </label>
      <span className="card__meta">{t('apiKeyHint')}</span>
      <label className="field">
        <span className="field__label">{t('tools')}</span>
        <input
          className="searchbox"
          value={form.toolsAllow}
          onChange={(e) => setForm({ ...form, toolsAllow: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('fsScope')}</span>
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
      <label className="field field--inline">
        <input
          type="checkbox"
          checked={form.net}
          onChange={(e) => setForm({ ...form, net: e.target.checked })}
        />
        <span>{t('net')}</span>
      </label>
      <div className="field">
        <span className="field__label">{t('scope')}</span>
        <div className="search-opts">
          <label className="search-opt">
            <input
              type="radio"
              checked={form.scope === 'global'}
              disabled={Boolean(entity)}
              onChange={() => setForm({ ...form, scope: 'global' })}
            />
            <span>{te('configScope.global')}</span>
          </label>
          <label className="search-opt">
            <input
              type="radio"
              checked={form.scope === 'project'}
              disabled={Boolean(entity)}
              onChange={() => setForm({ ...form, scope: 'project' })}
            />
            <span>{te('configScope.project')}</span>
          </label>
          <label className="search-opt">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />
            <span>{t('isDefault')}</span>
          </label>
        </div>
      </div>

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
