import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, Radio } from 'antd';
import { FilePlus2, Upload } from 'lucide-react';
import type {
  ConfigScope,
  TemplateCheck,
  TemplateInfo,
  TemplateKind,
} from '@fireeyeaud/shared';
import {
  getTemplateContent,
  inspectTemplateFile,
  replaceTemplateFile,
  type TemplateInspectResult,
} from '../../lib/api';
import { useTemplatesStore } from '../../store/templates';
import { useWorkspaceStore } from '../../store/workspace';
import { FormActions } from './FormActions';
import { FormError } from './FormError';
import { useUnsavedGuard } from './UnsavedGuard';

const DocxPreview = lazy(() =>
  import('../preview/DocxPreview').then((module) => ({ default: module.DocxPreview })),
);

interface FormState {
  name: string;
  kind: TemplateKind;
  scope: ConfigScope;
  isDefault: boolean;
  path: string;
}

function init(
  entity: TemplateInfo | undefined,
  kind: TemplateKind,
  hasWorkspace: boolean,
): FormState {
  if (!entity) {
    // 没有工作区时不能保存到「本项目」，默认落到全局。
    return {
      name: '',
      kind,
      scope: hasWorkspace ? 'project' : 'global',
      isDefault: false,
      path: '',
    };
  }
  return {
    name: entity.name,
    kind: entity.kind,
    scope: entity.scope,
    isDefault: Boolean(entity.isDefault),
    path: '',
  };
}

/**
 * 模板新增 / 编辑表单（右侧 tab）：上半填表，下半预览 docx。
 *
 * 预览只在这里做：新增时预览本地待添加文件（`/templates/inspect`），
 * 编辑时预览已保存的模板（`/templates/{id}/content`）。
 */
export function TemplateForm({
  entity,
  templateKind,
  onSaved,
  onCancel,
}: {
  entity?: TemplateInfo;
  templateKind?: TemplateKind;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('templates');
  const { t: tc } = useTranslation('common');
  const upload = useTemplatesStore((s) => s.upload);
  const edit = useTemplatesStore((s) => s.edit);
  const storeError = useTemplatesStore((s) => s.errorKey);
  const hasWorkspace = useWorkspaceStore((s) => Boolean(s.path));

  const initialRef = useRef<FormState>(
    init(entity, templateKind ?? 'evidence-form', hasWorkspace),
  );
  const [form, setForm] = useState<FormState>(initialRef.current);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const [preview, setPreview] = useState<{ data: string; mime: string } | null>(null);
  const [check, setCheck] = useState<TemplateCheck | null>(entity?.check ?? null);
  /** 编辑时选中的新文件（保存时覆盖原模板文件）。 */
  const [replacement, setReplacement] = useState('');

  const editing = Boolean(entity);
  const dirty =
    JSON.stringify(form) !== JSON.stringify(initialRef.current) || Boolean(replacement);
  const moved = editing && entity ? form.scope !== entity.scope : false;

  // 编辑已有模板：预览已保存的文件。
  useEffect(() => {
    if (!entity) return;
    let cancelled = false;
    void getTemplateContent(entity.id, entity.scope)
      .then((content) => {
        if (cancelled) return;
        if (content.ok && content.kind === 'base64') {
          setPreview({ data: content.data, mime: content.mime });
        }
      })
      .catch(() => {
        if (!cancelled) setErrorKey('error.templateNotFound');
      });
    return () => {
      cancelled = true;
    };
  }, [entity?.id, entity?.scope]);

  const pickFile = async (mode: 'create' | 'replace') => {
    const api = window.fireeyeaud;
    if (!api?.openFiles) {
      setErrorKey('error.opFailed');
      return;
    }
    try {
      const selected = await api.openFiles('templates');
      const path = selected[0];
      if (!path) return;
      setErrorKey(null);
      const info: TemplateInspectResult = await inspectTemplateFile(path, form.kind);
      setPreview({ data: info.data, mime: info.mime });
      setCheck(info.check);
      if (mode === 'replace') {
        setReplacement(path);
        return;
      }
      setForm((prev) => ({
        ...prev,
        path,
        // 名称默认取文件名，用户可改
        name: prev.name.trim() || info.name,
      }));
    } catch (err) {
      setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
    }
  };

  const save = async (): Promise<boolean> => {
    const name = form.name.trim();
    if (!name) return false;
    if (!editing && !form.path) return false;
    // 没有工作区时不允许保存到「本项目」
    if (form.scope === 'project' && !hasWorkspace) return false;

    setBusy(true);
    setErrorKey(null);
    try {
      if (editing && entity) {
        // 先覆盖文件（在源作用域），再改元数据 / 搬家，避免把文件写到错误的作用域。
        if (replacement) {
          await replaceTemplateFile(entity.id, entity.scope, replacement);
        }
        await edit(entity.id, entity.scope, {
          name,
          isDefault: form.isDefault,
          ...(moved ? { scope: form.scope } : {}),
        });
      } else {
        await upload(form.kind, [form.path], form.scope, form.isDefault, name);
      }
      setBusy(false);
      return true;
    } catch (err) {
      setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
      setBusy(false);
      return false;
    }
  };

  const { modal, forceLeave } = useUnsavedGuard(dirty, save, entity?.name);

  const close = (cb: () => void) => {
    forceLeave();
    cb();
  };

  const displayedError = errorKey ?? storeError;

  return (
    <div className="formtab__form tpl-form">
      <label className="field">
        <span className="field__label">{t('name')}</span>
        <input
          className="searchbox"
          value={form.name}
          placeholder={t('namePlaceholder')}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="field__label">{t('templateKind')}</span>
        <select
          className="searchbox"
          value={form.kind}
          disabled={editing}
          onChange={(e) => setForm({ ...form, kind: e.target.value as TemplateKind })}
        >
          <option value="evidence-form">{t('evidenceForm')}</option>
          <option value="report">{t('report')}</option>
        </select>
      </label>

      <div className="field">
        <span className="field__label">{t('scope')}</span>
        <Radio.Group
          value={form.scope}
          onChange={(event) =>
            setForm({ ...form, scope: event.target.value as ConfigScope })
          }
        >
          <Radio value="global">{t('scopeGlobal')}</Radio>
          <Radio value="project" disabled={!hasWorkspace}>
            {t('scopeProject')}
          </Radio>
        </Radio.Group>
        {!hasWorkspace && <span className="card__meta">{tc('noWorkspace')}</span>}
        {moved && <span className="card__meta">{t('moveHint')}</span>}
      </div>

      <Checkbox
        checked={form.isDefault}
        onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
      >
        {t('setAsDefault')}
      </Checkbox>

      <div className="field">
        <span className="field__label">
          {editing ? t('replaceFile') : t('file')}
        </span>
        <div className="tpl-form__file">
          <button
            type="button"
            className="button button--sm button--ghost"
            onClick={() => void pickFile(editing ? 'replace' : 'create')}
          >
            <Upload size={12} strokeWidth={1.9} />{' '}
            {editing ? t('replaceFile') : t('selectFile')}
          </button>
          <span className="card__meta">
            {editing
              ? replacement
                ? replacement.split(/[\\/]/).pop()
                : t('keepFile')
              : form.path
                ? form.path.split(/[\\/]/).pop()
                : t('noFile')}
          </span>
        </div>
        <span className="card__meta">
          {editing ? t('replaceHint') : t('singleFileHint')}
        </span>
      </div>

      {displayedError && (
        <FormError errorKey={displayedError.replace(/^error\./, '')} />
      )}

      <div className="tpl-form__preview">
        <div className="tpl-form__preview-head">
          <span className="card__meta">{t('preview')}</span>
          <span className="spacer" />
          {check && (
            <span className="tpl-row__check tpl-row__check--ok">
              {t('referenceTemplate')}
              {check.tags.length > 0
                ? ` · ${t('templateFields', { count: check.tags.length })}`
                : ` · ${t('templateNoFields')}`}
              {check.loops.length > 0 &&
                ` · ${t('templateLoops', { count: check.loops.length })}`}
            </span>
          )}
        </div>
        {preview ? (
          <div className="tpl-form__pages">
            <Suspense fallback={<span className="card__meta">{tc('loading')}</span>}>
              <DocxPreview data={preview.data} mime={preview.mime} fitWidth />
            </Suspense>
          </div>
        ) : (
          <div className="panel-empty">
            <FilePlus2 size={18} strokeWidth={1.5} />
            <span>{editing ? t('previewFailed') : t('noFile')}</span>
          </div>
        )}
      </div>

      <FormActions
        create={!editing}
        busy={busy}
        disabled={
          !form.name.trim() ||
          (!editing && !form.path) ||
          (form.scope === 'project' && !hasWorkspace)
        }
        onSave={() => void save().then((ok) => ok && onSaved())}
        onCancel={() => close(onCancel)}
      />
      {modal}
    </div>
  );
}