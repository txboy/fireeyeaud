import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { message } from 'antd';
import { Download, FileCheck2, Plus, Trash2 } from 'lucide-react';
import type { EvidenceFormManifest } from '@fireeyeaud/shared';
import { ScopeBadge } from '../ScopeBadge';
import { GenerateFormDialog } from '../artifacts/GenerateFormDialog';
import { ReceiptDialog } from '../artifacts/ReceiptDialog';
import { useFormsStore } from '../../store/forms';
import { useFindingsStore } from '../../store/findings';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';
import { useConfirmStore } from '../../store/confirm';

/** 成果栏「取证单」：生成、预览、下载、回执与删除。 */
export function EvidenceFormsView() {
  const { t } = useTranslation('evidence-form');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const items = useFormsStore((s) => s.items);
  const loading = useFormsStore((s) => s.loading);
  const errorKey = useFormsStore((s) => s.errorKey);
  const load = useFormsStore((s) => s.load);
  const remove = useFormsStore((s) => s.remove);
  const selectedIds = useFindingsStore((s) => s.selectedIds);
  const wsPath = useWorkspaceStore((s) => s.path);
  const openPreview = useUiStore((s) => s.openPreview);
  const confirm = useConfirmStore((s) => s.confirm);

  const [generating, setGenerating] = useState(false);
  const [receiptFor, setReceiptFor] = useState<EvidenceFormManifest | null>(null);

  useEffect(() => {
    if (wsPath) void load();
  }, [load, wsPath]);

  if (!wsPath) {
    return (
      <div className="panel-empty">
        <span>{tc('noWorkspace')}</span>
      </div>
    );
  }

  const docPath = (form: EvidenceFormManifest) => {
    const fileName =
      form.files.find((f) => f === 'document.docx') ?? form.files[0] ?? 'document.docx';
    return `${wsPath}/${form.artifactRef}/${fileName}`;
  };

  const preview = (form: EvidenceFormManifest) => {
    void openPreview(wsPath, docPath(form), `${form.id}.docx`);
  };

  const download = async (form: EvidenceFormManifest) => {
    const api = window.fireeyeaud;
    if (!api?.saveFile) return;
    const result = await api.saveFile({
      sourcePath: docPath(form),
      suggestedName: `${form.id}.docx`,
      filters: [{ name: 'Word', extensions: ['docx'] }],
    });
    if (result.ok) void message.success(t('download'));
  };

  const del = async (form: EvidenceFormManifest) => {
    const ok = await confirm({
      title: t('delete'),
      message: t('deleteConfirm'),
      confirmLabel: tc('delete'),
      cancelLabel: tc('cancel'),
      danger: true,
    });
    if (ok) await remove(form.id).catch(() => undefined);
  };

  return (
    <>
      <div className="artifact-toolbar">
        <button
          type="button"
          className="button button--sm"
          onClick={() => setGenerating(true)}
        >
          <Plus size={12} strokeWidth={2} /> {t('generate')}
        </button>
        <span className="card__meta">
          {selectedIds.length > 0
            ? t('selectedFindings', { count: selectedIds.length })
            : t('noSelection')}
        </span>
      </div>

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
        <div className="artifact-list">
          {items.map((form) => (
            <div key={form.id} className="artifact-row">
              <FileCheck2 size={14} strokeWidth={1.75} />
              <div className="artifact-row__main">
                <div className="artifact-row__title" title={form.title}>
                  {form.id} · {form.title}
                </div>
                <div className="artifact-row__meta">
                  <ScopeBadge scope={form.templateScope} />
                  {form.templateName && ` ${form.templateName}`} ·{' '}
                  {t('findingsCount', { count: form.findingIds.length })} ·{' '}
                  {form.createdAt.slice(0, 10)}
                  {form.receipt && (
                    <span className="receipt-badge"> {t('receipt')}</span>
                  )}
                </div>
              </div>
              <div className="artifact-row__actions">
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  onClick={() => preview(form)}
                >
                  {t('preview')}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title={t('download')}
                  onClick={() => void download(form)}
                >
                  <Download size={13} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  onClick={() => setReceiptFor(form)}
                >
                  {form.receipt ? t('replaceReceipt') : t('uploadReceipt')}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title={t('delete')}
                  onClick={() => void del(form)}
                >
                  <Trash2 size={13} strokeWidth={1.75} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <GenerateFormDialog open={generating} onClose={() => setGenerating(false)} />

      <ReceiptDialog
        open={receiptFor !== null}
        form={items.find((item) => item.id === receiptFor?.id) ?? null}
        onClose={() => setReceiptFor(null)}
      />
    </>
  );
}