import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { message } from 'antd';
import { Download, FileCheck2, FileText, Plus, Trash2 } from 'lucide-react';
import type { EvidenceFormManifest } from '@fireeyeaud/shared';
import { NewEvidenceFormDialog } from './NewEvidenceFormDialog';
import { ReceiptDialog } from '../artifacts/ReceiptDialog';
import { useFormsStore } from '../../store/forms';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';
import { useConfirmStore } from '../../store/confirm';

/**
 * 左侧活动栏「取证单」：与「项目报告」面板同构——
 * 上栏取证单记录，下栏疑点数量汇总；点击记录打开右侧写作台。
 */
export function EvidenceFormsPanel() {
  const { t } = useTranslation('evidence-form');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const items = useFormsStore((s) => s.items);
  const loading = useFormsStore((s) => s.loading);
  const errorKey = useFormsStore((s) => s.errorKey);
  const load = useFormsStore((s) => s.load);
  const remove = useFormsStore((s) => s.remove);

  const wsPath = useWorkspaceStore((s) => s.path);
  const openEvidenceForm = useUiStore((s) => s.openEvidenceForm);
  const closeRightTab = useUiStore((s) => s.closeRightTab);
  const confirm = useConfirmStore((s) => s.confirm);

  const [creating, setCreating] = useState(false);
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

  const isSaved = (form: EvidenceFormManifest) =>
    form.status === 'saved' || (!form.status && form.files.includes('document.docx'));

  const statusLabel = (form: EvidenceFormManifest) => {
    if (isSaved(form)) return t('statusSaved');
    return form.files.includes('document.docx') ? t('statusDirty') : t('statusDraft');
  };

  const findingCount = (form: EvidenceFormManifest) => form.findingsSnapshot.length;

  const download = async (form: EvidenceFormManifest) => {
    const api = window.fireeyeaud;
    if (!api?.saveFile) return;
    const result = await api.saveFile({
      sourcePath: `${wsPath}/${form.artifactRef}/document.docx`,
      suggestedName: `${form.id} ${form.title}.docx`.replace(/[\\/:*?"<>|]/g, '_'),
      filters: [{ name: 'Word', extensions: ['docx'] }],
    });
    if (result.ok) void message.success(t('downloaded'));
  };

  const del = async (form: EvidenceFormManifest) => {
    const ok = await confirm({
      title: t('delete'),
      message: t('deleteConfirm'),
      confirmLabel: tc('delete'),
      cancelLabel: tc('cancel'),
      danger: true,
    });
    if (!ok) return;
    await remove(form.id).catch(() => undefined);
    await closeRightTab(`form:${form.id}`);
  };

  return (
    <div className="reports-panel">
      <section className="reports-pane">
        <div className="reports-pane__head">
          <span className="reports-pane__title">{t('records')}</span>
          <span className="spacer" />
          <button
            type="button"
            className="button button--sm"
            onClick={() => setCreating(true)}
          >
            <Plus size={12} strokeWidth={2} /> {t('newForm')}
          </button>
        </div>

        {errorKey && (
          <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
        )}

        <div className="reports-pane__body">
          {loading && items.length === 0 ? (
            <div className="panel-empty">
              <span>{tc('loading')}</span>
            </div>
          ) : items.length === 0 ? (
            <div className="panel-empty">
              <span>{t('empty')}</span>
            </div>
          ) : (
            items.map((form) => (
              <div key={form.id} className="report-row">
                <button
                  type="button"
                  className="report-row__main"
                  onClick={() => void openEvidenceForm(form.id, form.title)}
                >
                  <FileCheck2 size={14} strokeWidth={1.75} />
                  <span className="report-row__title" title={form.title}>
                    {form.id} · {form.title}
                  </span>
                </button>
                <div className="report-row__meta">
                  <span
                    className={`report-status${isSaved(form) ? '' : ' report-status--draft'}`}
                  >
                    {statusLabel(form)}
                  </span>
                  <span className="card__meta">
                    {t('findingsCount', { count: findingCount(form) })}
                  </span>
                  {form.receipt && (
                    <span className="receipt-badge">{form.receipt.name}</span>
                  )}
                </div>
                <div className="report-row__actions">
                  {form.files.includes('document.docx') && (
                    <button
                      type="button"
                      className="icon-btn"
                      title={t('download')}
                      onClick={() => void download(form)}
                    >
                      <Download size={13} strokeWidth={1.75} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    title={form.receipt ? t('replaceReceipt') : t('uploadReceipt')}
                    onClick={() => setReceiptFor(form)}
                  >
                    <FileText size={13} strokeWidth={1.75} />
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
            ))
          )}
        </div>
      </section>

      <section className="reports-pane reports-pane--forms">
        <div className="reports-pane__head">
          <span className="reports-pane__title">{t('formOverview')}</span>
          <span className="spacer" />
          <span className="card__meta">{items.length}</span>
        </div>
        <div className="reports-pane__body">
          {items.length === 0 ? (
            <div className="panel-empty">
              <span>{t('empty')}</span>
            </div>
          ) : (
            items.map((form) => (
              <button
                key={form.id}
                type="button"
                className="report-form-row"
                onClick={() => void openEvidenceForm(form.id, form.title)}
              >
                <FileCheck2 size={13} strokeWidth={1.75} />
                <span className="report-form-row__body">
                  <span className="report-form-row__title" title={form.title}>
                    {form.id} · {form.title}
                  </span>
                  <span className="report-form-row__meta">
                    <span>{t('findingsCount', { count: findingCount(form) })}</span>
                    <span className="card__meta">{statusLabel(form)}</span>
                    {form.templateName && (
                      <span className="card__meta">{form.templateName}</span>
                    )}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      <NewEvidenceFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(formId, title) => {
          void openEvidenceForm(formId, title);
        }}
      />

      <ReceiptDialog
        open={receiptFor !== null}
        form={items.find((item) => item.id === receiptFor?.id) ?? null}
        onClose={() => setReceiptFor(null)}
      />
    </div>
  );
}