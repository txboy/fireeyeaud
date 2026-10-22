import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { message } from 'antd';
import { Download, FileText, Plus, Trash2 } from 'lucide-react';
import type { ReportManifest } from '@fireeyeaud/shared';
import { NewReportDialog } from './NewReportDialog';
import { useReportsStore } from '../../store/reports';
import { useFormsStore } from '../../store/forms';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';
import { useConfirmStore } from '../../store/confirm';

/** 项目报告模块：上栏报告记录、下栏本项目取证单。 */
export function ReportsPanel() {
  const { t } = useTranslation('report');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const items = useReportsStore((s) => s.items);
  const loading = useReportsStore((s) => s.loading);
  const errorKey = useReportsStore((s) => s.errorKey);
  const load = useReportsStore((s) => s.load);
  const remove = useReportsStore((s) => s.remove);
  const forms = useFormsStore((s) => s.items);
  const loadForms = useFormsStore((s) => s.load);
  const wsPath = useWorkspaceStore((s) => s.path);
  const openPreview = useUiStore((s) => s.openPreview);
  const openReport = useUiStore((s) => s.openReport);
  const closeRightTab = useUiStore((s) => s.closeRightTab);
  const confirm = useConfirmStore((s) => s.confirm);

  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!wsPath) return;
    void load();
    void loadForms();
  }, [load, loadForms, wsPath]);

  if (!wsPath) {
    return (
      <div className="panel-empty">
        <span>{tc('noWorkspace')}</span>
      </div>
    );
  }

  const isWorkspaceReport = (report: ReportManifest) =>
    report.status === 'draft' || report.files.includes('body.json');

  const previewDocx = (report: ReportManifest) => {
    void openPreview(
      wsPath,
      `${wsPath}/${report.artifactRef}/document.docx`,
      `${report.id}.docx`,
    );
  };

  const open = (report: ReportManifest) => {
    if (isWorkspaceReport(report)) {
      void openReport(report.id, report.title);
    } else {
      previewDocx(report);
    }
  };

  const previewForm = (formId: string, artifactRef: string) => {
    void openPreview(
      wsPath,
      `${wsPath}/${artifactRef}/document.docx`,
      `${formId}.docx`,
    );
  };

  const del = async (report: ReportManifest) => {
    const ok = await confirm({
      title: t('delete'),
      message: t('deleteConfirm'),
      confirmLabel: tc('delete'),
      cancelLabel: tc('cancel'),
      danger: true,
    });
    if (!ok) return;
    await remove(report.id).catch(() => undefined);
    await closeRightTab(`report:${report.id}`);
  };

  const download = async (report: ReportManifest) => {
    const api = window.fireeyeaud;
    if (!api?.saveFile) return;
    const result = await api.saveFile({
      sourcePath: `${wsPath}/${report.artifactRef}/document.docx`,
      suggestedName: `${report.id} ${report.title}.docx`.replace(/[\\/:*?"<>|]/g, '_'),
      filters: [{ name: 'Word', extensions: ['docx'] }],
    });
    if (result.ok) void message.success(t('downloaded'));
  };

  /** 没有 status 字段的旧报告：有 document.docx 即视为已保存。 */
  const isSaved = (report: ReportManifest) =>
    report.status === 'saved' ||
    (!report.status && report.files.includes('document.docx'));

  const statusLabel = (report: ReportManifest) => {
    if (isSaved(report)) return t('statusSaved');
    return report.files.includes('document.docx') ? t('statusDirty') : t('statusDraft');
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
            <Plus size={12} strokeWidth={2} /> {t('newReport')}
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
            items.map((report) => (
              <div key={report.id} className="report-row">
                <button
                  type="button"
                  className="report-row__main"
                  onClick={() => open(report)}
                >
                  <FileText size={14} strokeWidth={1.75} />
                  <span className="report-row__title" title={report.title}>
                    {report.id} · {report.title}
                  </span>
                </button>
                <div className="report-row__meta">
                  <span
                    className={`report-status${isSaved(report) ? '' : ' report-status--draft'}`}
                  >
                    {statusLabel(report)}
                  </span>
                  <span className="card__meta report-row__date">
                    {(report.updatedAt ?? report.createdAt).slice(0, 10)}
                  </span>
                </div>
                <div className="report-row__actions">
                  {report.files.includes('document.docx') && (
                    <button
                      type="button"
                      className="icon-btn"
                      title={t('download')}
                      onClick={() => void download(report)}
                    >
                      <Download size={13} strokeWidth={1.75} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    title={t('delete')}
                    onClick={() => void del(report)}
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
          <span className="reports-pane__title">{t('projectForms')}</span>
          <span className="card__meta">{forms.length}</span>
        </div>
        <div className="reports-pane__body">
          {forms.length === 0 ? (
            <div className="panel-empty">
              <span>{t('noForms')}</span>
            </div>
          ) : (
            forms.map((form) => (
              <button
                key={form.id}
                type="button"
                className="report-form-row"
                onClick={() => previewForm(form.id, form.artifactRef)}
              >
                <FileText size={13} strokeWidth={1.75} />
                <span className="report-form-row__body">
                  <span className="report-form-row__title" title={form.title}>
                    {form.id} · {form.title}
                  </span>
                  <span className="report-form-row__meta">
                    <span>{t('formFindings', { count: form.findingIds.length })}</span>
                    {form.receipt && <span className="receipt-badge">{form.receipt.name}</span>}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      <NewReportDialog
        open={creating}
        forms={forms}
        onClose={() => setCreating(false)}
        onCreated={(reportId, title) => {
          void openReport(reportId, title);
        }}
      />
    </div>
  );
}
