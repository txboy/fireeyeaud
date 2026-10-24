import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { message } from 'antd';
import { Download, FileCheck2, FileText, Plus, Trash2 } from 'lucide-react';
import type { EvidenceFormManifest } from '@fireeyeaud/shared';
import { NewEvidenceFormDialog } from '../forms/NewEvidenceFormDialog';
import { ReceiptDialog } from '../artifacts/ReceiptDialog';
import { useFormsStore } from '../../store/forms';
import { useFindingsStore } from '../../store/findings';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';
import { useConfirmStore } from '../../store/confirm';

/**
 * 取证单模块（仿项目报告）：上栏取证单记录、下栏可选疑点。
 * 新建即进入写作台，导出后才产生 document.docx。
 */
export function EvidenceFormsView() {
  const { t } = useTranslation('evidence-form');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const items = useFormsStore((s) => s.items);
  const loading = useFormsStore((s) => s.loading);
  const errorKey = useFormsStore((s) => s.errorKey);
  const load = useFormsStore((s) => s.load);
  const remove = useFormsStore((s) => s.remove);

  const findings = useFindingsStore((s) => s.items);
  const loadFindings = useFindingsStore((s) => s.load);
  const selectedIds = useFindingsStore((s) => s.selectedIds);
  const toggleSelected = useFindingsStore((s) => s.toggleSelected);
  const clearSelected = useFindingsStore((s) => s.clearSelected);

  const wsPath = useWorkspaceStore((s) => s.path);
  const openEvidenceForm = useUiStore((s) => s.openEvidenceForm);
  const closeRightTab = useUiStore((s) => s.closeRightTab);
  const confirm = useConfirmStore((s) => s.confirm);

  const [creating, setCreating] = useState(false);
  const [receiptFor, setReceiptFor] = useState<EvidenceFormManifest | null>(null);

  useEffect(() => {
    if (!wsPath) return;
    void load();
    void loadFindings({ limit: 200 });
  }, [load, loadFindings, wsPath]);

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
                  {form.receipt && <span className="receipt-badge">{form.receipt.name}</span>}
                  <span className="card__meta report-row__date">
                    {(form.updatedAt ?? form.createdAt).slice(0, 10)}
                  </span>
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
            ))
          )}
        </div>
      </section>

      <section className="reports-pane reports-pane--forms">
        <div className="reports-pane__head">
          <span className="reports-pane__title">{t('availableFindings')}</span>
          <span className="card__meta">{selectedIds.length}</span>
          <span className="spacer" />
          {selectedIds.length > 0 && (
            <button
              type="button"
              className="button button--sm button--ghost"
              onClick={clearSelected}
            >
              {tc('clear')}
            </button>
          )}
        </div>
        <div className="reports-pane__body">
          {findings.length === 0 ? (
            <div className="panel-empty">
              <span>{t('noFindings')}</span>
            </div>
          ) : (
            findings.map((finding) => (
              <label key={finding.id} className="artifact-select__item report-form-row">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(finding.id)}
                  onChange={() => toggleSelected(finding.id)}
                />
                <FileText size={13} strokeWidth={1.75} />
                <span className="artifact-select__label">
                  {finding.id} · {finding.title?.text || finding.ruleKey || ''}
                </span>
              </label>
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