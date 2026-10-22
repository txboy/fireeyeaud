import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Radio, Segmented } from 'antd';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  Pencil,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ConfigScope, TemplateInfo, TemplateKind } from '@fireeyeaud/shared';
import { ScopeBadge } from '../ScopeBadge';
import { UploadTemplateDialog } from '../templates/UploadTemplateDialog';
import { TemplatePreviewModal } from '../templates/TemplatePreviewModal';
import { useTemplatesStore } from '../../store/templates';
import { usePromptStore } from '../../store/prompt';
import { useConfirmStore } from '../../store/confirm';
import { useWorkspaceStore } from '../../store/workspace';

type ScopeFilter = 'all' | 'global' | 'project';

const KIND_ORDER: TemplateKind[] = ['evidence-form', 'report'];

/** 模板中心：全局 / 本项目 docx 模板的上传、体检、预览与默认设置。 */
export function TemplatesPanel() {
  const { t } = useTranslation('templates');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');

  const items = useTemplatesStore((s) => s.items);
  const loading = useTemplatesStore((s) => s.loading);
  const errorKey = useTemplatesStore((s) => s.errorKey);
  const load = useTemplatesStore((s) => s.load);
  const rename = useTemplatesStore((s) => s.rename);
  const setDefault = useTemplatesStore((s) => s.setDefault);
  const remove = useTemplatesStore((s) => s.remove);
  const duplicate = useTemplatesStore((s) => s.duplicate);

  const prompt = usePromptStore((s) => s.prompt);
  const confirm = useConfirmStore((s) => s.confirm);
  const path = useWorkspaceStore((s) => s.path);

  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [uploadKind, setUploadKind] = useState<TemplateKind | null>(null);
  const [preview, setPreview] = useState<TemplateInfo | null>(null);
  const [duplicating, setDuplicating] = useState<TemplateInfo | null>(null);
  const [duplicateScope, setDuplicateScope] = useState<ConfigScope>('global');

  // 全局模板无需打开项目也能管理，所以不按 path 门槛；path 变化时重新合并。
  useEffect(() => {
    void load();
  }, [load, path]);

  const visible = useMemo(
    () =>
      scopeFilter === 'all'
        ? items
        : items.filter((item) => item.scope === scopeFilter),
    [items, scopeFilter],
  );

  const hasTwoDefaults = useMemo(() => {
    // 默认是「作用域 + 类型」维度的：只有同一 kind 在两个作用域都有默认才提示。
    return KIND_ORDER.some((kind) => {
      const defaults = items.filter(
        (i) => i.kind === kind && i.isDefault && !i.builtin,
      );
      return (
        defaults.some((i) => i.scope === 'project') &&
        defaults.some((i) => i.scope === 'global')
      );
    });
  }, [items]);

  const uploadDefaultScope: ConfigScope =
    scopeFilter === 'global' ? 'global' : 'project';

  const onRename = async (item: TemplateInfo) => {
    const name = await prompt({
      title: t('rename'),
      label: t('name'),
      defaultValue: item.name,
      confirmLabel: tc('save'),
      cancelLabel: tc('cancel'),
    });
    if (name == null || !name.trim()) return;
    // store 已记录 errorKey，这里只需吞掉 rejection（避免未处理 Promise）。
    await rename(item.id, item.scope, name.trim()).catch(() => undefined);
  };

  const onDelete = async (item: TemplateInfo) => {
    const ok = await confirm({
      title: t('delete'),
      message: t('deleteConfirm'),
      confirmLabel: tc('delete'),
      cancelLabel: tc('cancel'),
      danger: true,
    });
    if (ok) await remove(item.id, item.scope).catch(() => undefined);
  };

  const onDuplicate = async () => {
    if (!duplicating) return;
    try {
      await duplicate(duplicating.id, duplicating.scope, duplicateScope);
      setDuplicating(null);
    } catch {
      // errorKey 已由 store 记录；保持弹窗打开让用户改选目标作用域。
    }
  };

  const renderCheck = (item: TemplateInfo) => {
    const { check } = item;
    const unclosed = check.unclosed ?? [];
    if (check.ok) {
      return (
        <span className="tpl-row__check tpl-row__check--ok">
          <CheckCircle2 size={11} strokeWidth={2} />
          <span>
            {t('checkOk')}
            {check.loops.length === 0 && (
              <span className="tpl-row__detail">{t('noLoop')}</span>
            )}
            {unclosed.length > 0 && (
              <span className="tpl-row__detail tpl-row__detail--warn">
                {t('unclosed', { fields: unclosed.join('、') })}
              </span>
            )}
          </span>
        </span>
      );
    }
    return (
      <span className="tpl-row__check tpl-row__check--warn">
        <AlertTriangle size={11} strokeWidth={2} />
        <span>
          {t('checkWarn')}
          {check.unknown.length > 0 && (
            <span className="tpl-row__detail">
              {t('unknown', { fields: check.unknown.join('、') })}
            </span>
          )}
          {check.missing.length > 0 && (
            <span className="tpl-row__detail">
              {t('missing', { fields: check.missing.join('、') })}
            </span>
          )}
          {unclosed.length > 0 && (
            <span className="tpl-row__detail">
              {t('unclosed', { fields: unclosed.join('、') })}
            </span>
          )}
          {check.loops.length > 0 ? (
            <span className="tpl-row__detail">
              {t('loops', { fields: check.loops.join('、') })}
            </span>
          ) : (
            <span className="tpl-row__detail">{t('noLoop')}</span>
          )}
        </span>
      </span>
    );
  };

  return (
    <>
      <div className="tpl-toolbar">
        <Segmented
          size="small"
          value={scopeFilter}
          onChange={(value) => setScopeFilter(value as ScopeFilter)}
          options={[
            { value: 'all', label: t('scopeAll') },
            { value: 'global', label: t('scopeGlobal') },
            { value: 'project', label: t('scopeProject') },
          ]}
        />
      </div>

      {hasTwoDefaults && <div className="card__meta tpl-hint">{t('defaultHint')}</div>}

      {errorKey && (
        <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
      )}

      {KIND_ORDER.map((kind) => {
        const group = visible.filter((item) => item.kind === kind);
        const title = kind === 'evidence-form' ? t('evidenceForm') : t('report');
        return (
          <section key={kind} className="tpl-group">
            <div className="tpl-group__head">
              <span>{title}</span>
              <span className="spacer" />
              <button
                type="button"
                className="button button--sm"
                onClick={() => setUploadKind(kind)}
              >
                <Upload size={12} strokeWidth={1.9} /> {t('upload')}
              </button>
            </div>

            {loading && items.length === 0 ? (
              <div className="panel-empty">
                <span>{tc('loading')}</span>
              </div>
            ) : group.length === 0 ? (
              <div className="panel-empty">
                <span>{t('empty')}</span>
              </div>
            ) : (
              group.map((item) => (
                <div key={`${item.scope}:${item.id}`} className="tpl-row">
                  <div className="tpl-row__top">
                    <span className="tpl-row__name" title={item.fileName}>
                      {item.name}
                    </span>
                    <ScopeBadge scope={item.scope} />
                    {item.isDefault && <span className="tpl-badge">{t('default')}</span>}
                    {item.builtin && (
                      <span className="tpl-badge tpl-badge--builtin">{t('builtin')}</span>
                    )}
                    <span className="spacer" />
                    <div className="tpl-row__actions">
                      <button
                        type="button"
                        className="icon-btn"
                        title={t('preview')}
                        onClick={() => setPreview(item)}
                      >
                        <Eye size={13} strokeWidth={1.75} />
                      </button>
                      {!item.builtin && !item.isDefault && (
                        <button
                          type="button"
                          className="icon-btn"
                          title={t('setDefault')}
                          onClick={() => void setDefault(item.id, item.scope)}
                        >
                          <Star size={13} strokeWidth={1.75} />
                        </button>
                      )}
                      {!item.builtin && (
                        <button
                          type="button"
                          className="icon-btn"
                          title={t('rename')}
                          onClick={() => void onRename(item)}
                        >
                          <Pencil size={13} strokeWidth={1.75} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-btn"
                        title={t('duplicate')}
                        onClick={() => {
                          setDuplicating(item);
                          // 目标默认取「相反作用域」；没有工作区时只能复制到全局。
                          setDuplicateScope(
                            !path ? 'global' : item.scope === 'project' ? 'global' : 'project',
                          );
                        }}
                      >
                        <Copy size={13} strokeWidth={1.75} />
                      </button>
                      {!item.builtin && (
                        <button
                          type="button"
                          className="icon-btn"
                          title={t('delete')}
                          onClick={() => void onDelete(item)}
                        >
                          <Trash2 size={13} strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  </div>
                  {renderCheck(item)}
                </div>
              ))
            )}
          </section>
        );
      })}

      <UploadTemplateDialog
        open={uploadKind !== null}
        kind={uploadKind ?? 'evidence-form'}
        defaultScope={uploadDefaultScope}
        onCancel={() => setUploadKind(null)}
        onUploaded={() => setUploadKind(null)}
      />

      <TemplatePreviewModal
        open={preview !== null}
        item={preview}
        onClose={() => setPreview(null)}
      />

      <Modal
        open={duplicating !== null}
        title={t('duplicate')}
        centered
        width={380}
        onCancel={() => setDuplicating(null)}
        footer={[
          <button
            key="cancel"
            type="button"
            className="button button--ghost"
            onClick={() => setDuplicating(null)}
          >
            {tc('cancel')}
          </button>,
          <button
            key="ok"
            type="button"
            className="button"
            disabled={duplicateScope === 'project' && !path}
            onClick={() => void onDuplicate()}
          >
            {t('duplicateTarget')}
          </button>,
        ]}
      >
        <p>{t('duplicateTarget')}</p>
        <Radio.Group
          value={duplicateScope}
          onChange={(event) => setDuplicateScope(event.target.value as ConfigScope)}
        >
          <Radio value="global">{t('duplicateToGlobal')}</Radio>
          <Radio value="project" disabled={!path}>
            {t('duplicateToProject')}
          </Radio>
        </Radio.Group>
      </Modal>
    </>
  );
}