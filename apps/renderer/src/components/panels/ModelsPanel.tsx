import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Server, Trash2, X, Zap } from 'lucide-react';
import type { ConfigScope, ModelProfile } from '@fireeyeaud/shared';
import { useModelsStore } from '../../store/models';
import { ScopeBadge } from '../ScopeBadge';

interface FormState {
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  temperature: string;
  isDefault: boolean;
  scope: ConfigScope;
}

const EMPTY: FormState = {
  name: '',
  provider: 'openai',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen2.5',
  temperature: '0.2',
  isDefault: false,
  scope: 'global',
};

export function ModelsPanel() {
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');
  const { t: te } = useTranslation('error');
  const { t: ten } = useTranslation('enums');
  const items = useModelsStore((s) => s.items);
  const loading = useModelsStore((s) => s.loading);
  const errorKey = useModelsStore((s) => s.errorKey);
  const load = useModelsStore((s) => s.load);
  const add = useModelsStore((s) => s.add);
  const edit = useModelsStore((s) => s.edit);
  const remove = useModelsStore((s) => s.remove);
  const test = useModelsStore((s) => s.test);

  const [editing, setEditing] = useState<ModelProfile | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [status, setStatus] = useState<Record<string, 'ok' | 'fail'>>({});

  useEffect(() => {
    void load();
  }, [load]);

  const startAdd = () => {
    setEditing(null);
    setForm(EMPTY);
    setFormOpen(true);
  };

  const startEdit = (item: ModelProfile) => {
    setEditing(item);
    setForm({
      name: item.name,
      provider: item.provider,
      baseUrl: item.baseUrl,
      model: item.model,
      temperature: String(item.temperature ?? 0.2),
      isDefault: Boolean(item.isDefault),
      scope: item.scope,
    });
    setFormOpen(true);
  };

  const save = async () => {
    const payload = {
      name: form.name.trim(),
      provider: form.provider.trim(),
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      temperature: Number(form.temperature) || 0.2,
      isDefault: form.isDefault,
      scope: form.scope,
    };
    if (!payload.name || !payload.baseUrl || !payload.model) return;
    if (editing) await edit(editing.id, editing.scope, payload);
    else await add(payload);
    setFormOpen(false);
    setEditing(null);
  };

  const runTest = async (item: ModelProfile) => {
    try {
      const ok = await test(item.id, item.scope);
      setStatus((s) => ({ ...s, [item.id]: ok ? 'ok' : 'fail' }));
    } catch {
      setStatus((s) => ({ ...s, [item.id]: 'fail' }));
    }
  };

  const field = (
    key: keyof FormState,
    label: string,
    type: 'text' | 'number' = 'text',
  ) => (
    <div className="field">
      <span className="field__label">{label}</span>
      <input
        className="searchbox"
        type={type}
        value={String(form[key])}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <>
      <div className="section-head">
        <span>{t('subtitle')}</span>
        <button type="button" className="button button--sm" onClick={startAdd}>
          <Plus size={13} strokeWidth={1.9} />
          {t('addModel')}
        </button>
      </div>

      {formOpen && (
        <div className="model-form">
          {field('name', t('name'))}
          {field('provider', t('provider'))}
          {field('baseUrl', t('baseUrl'))}
          {field('model', t('modelName'))}
          {field('temperature', t('temperature'), 'number')}
          <div className="field">
            <span className="field__label">{t('scope')}</span>
            <div className="search-opts">
              <label className="search-opt">
                <input
                  type="radio"
                  checked={form.scope === 'global'}
                  onChange={() => setForm((f) => ({ ...f, scope: 'global' }))}
                />
                <span>{ten('configScope.global')}</span>
              </label>
              <label className="search-opt">
                <input
                  type="radio"
                  checked={form.scope === 'project'}
                  onChange={() => setForm((f) => ({ ...f, scope: 'project' }))}
                />
                <span>{ten('configScope.project')}</span>
              </label>
              <label className="search-opt">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                />
                <span>{t('isDefault')}</span>
              </label>
            </div>
          </div>
          <div className="model-form__actions">
            <button type="button" className="button button--sm" onClick={() => void save()}>
              {tc('save')}
            </button>
            <button
              type="button"
              className="button button--sm button--ghost"
              onClick={() => {
                setFormOpen(false);
                setEditing(null);
              }}
            >
              {tc('cancel')}
            </button>
          </div>
        </div>
      )}

      {errorKey && (
        <span className="panel-error">{te(errorKey.replace(/^error\./, ''))}</span>
      )}

      {!formOpen && items.length === 0 && !loading && (
        <div className="panel-empty">
          <Server size={22} strokeWidth={1.5} />
          <span>{t('empty')}</span>
        </div>
      )}

      {items.map((item) => (
        <div key={item.id} className="card">
          <div className="card__row">
            <Server size={14} strokeWidth={1.75} />
            <span className="card__name">{item.name}</span>
            {item.isDefault && <span className="scope-badge">{t('isDefault')}</span>}
            <ScopeBadge scope={item.scope} />
            <span className="spacer" />
            <button
              type="button"
              className="icon-btn"
              title={tc('test')}
              onClick={() => void runTest(item)}
            >
              <Zap size={13} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={tc('edit')}
              onClick={() => startEdit(item)}
            >
              <Pencil size={13} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={tc('delete')}
              onClick={() => void remove(item.id, item.scope)}
            >
              <Trash2 size={13} strokeWidth={1.75} />
            </button>
          </div>
          <span className="card__meta">
            {item.model} · {item.baseUrl}
          </span>
          {status[item.id] === 'ok' && (
            <span className="model-status model-status--ok">
              <Zap size={11} strokeWidth={2} /> {t('testOk')}
            </span>
          )}
          {status[item.id] === 'fail' && (
            <span className="model-status model-status--fail">
              <X size={11} strokeWidth={2} /> {t('testFail')}
            </span>
          )}
        </div>
      ))}
    </>
  );
}
