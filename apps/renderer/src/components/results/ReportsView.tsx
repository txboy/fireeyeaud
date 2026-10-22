import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { message } from 'antd';
import { Download, FileText, Plus, Trash2 } from 'lucide-react';
import type { ReportManifest } from '@fireeyeaud/shared';
import { ScopeBadge } from '../ScopeBadge';
import { GenerateReportDialog } from '../artifacts/GenerateReportDialog';
import { useReportsStore } from '../../store/reports';
import { useFormsStore } from '../../store/forms';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';
import { useConfirmStore } from '../../store/confirm';

/** 成果栏「项目报告」：勾选取证单 → 生成 → 预览/下载/删除。 */
export function ReportsView() {
  const { t } = useTranslation('report');
  const { t: tf } = useTranslation('evidence-form');
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
  const confirm = useConfirmStore((s) => s.confirm);

  const [selectedFormIds, setSelectedFormIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);

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

  useEffect(() => {
    // 取证单被删除后清理失去引用的选择
    setSelectedFormIds((prev) => prev.filter((id) => forms.some((f) => f.id === id)));
  }, [forms]);

  const toggle = (id: string) =>
    setSelectedFormIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );

  const docPath = (report: ReportManifest) => {
    const fileName =
      report.files.find((f) => f === 'document.docx') ?? report.files[0] ?? 'document.docx';
    return `${wsPath}/${report.artifactRef}/${fileName}`;
  };

  const preview = (report: ReportManifest) => {
    void openPreview(wsPath, docPath(report), `${report.id}.docx`);
  };

  const download = async (report: ReportManifest) => {
    const api = window.fireeyeaud;
    if (!api?.saveFile) return;
    const result = await api.saveFile({
      sourcePath: docPath(report),
      suggestedName: `${report.id}.docx`,
      filters: [{ name: 'Word', extensions: ['docx'] }],
    });
    if (result.ok) void message.success(t('download'));
  };

  const del = async (report: ReportManifest) => {
    const ok = await confirm({
      title: t('delete'),
      message: t('deleteConfirm'),
      confirmLabel: tc('delete'),
      cancelLabel: tc('cancel'),
      danger: true,
    });
    if (ok) await remove(report.id).catch(() => undefined);
  };

  return (
    <>
      <div className="artifact-toolbar">
        <button
          type="button"
          className="button button--sm"
          disabled={selectedFormIds.length === 0}
          onClick={() => setGenerating(true)}
        >
          <Plus size={12} strokeWidth={2} /> {t('generate')}
        </button>
        <span className="card__meta">
          {selectedFormIds.length > 0
            ? t('selectedForms', { count: selectedFormIds.length })
            : t('noSelection')}
        </span>
      </div>

      {forms.length > 0 && (
        <div className="artifact-select">
          <div className="card__meta">{t('selectForms')}</div>
          {forms.map((form) => (
            <label key={form.id} className="artifact-select__item">
              <input
                type="checkbox"
                checked={selectedFormIds.includes(form.id)}
                onChange={() => toggle(form.id)}
              />
              <span className="artifact-select__label">
                {form.id} · {form.title}
              </span>
              <span className="card__meta">
                {tf('findingsCount', { count: form.findingIds.length })}
              </span>
            </label>
          ))}
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
        <div className="artifact-list">
          {items.map((report) => (
            <div key={report.id} className="artifact-row">
              <FileText size={14} strokeWidth={1.75} />
              <div className="artifact-row__main">
                <div className="artifact-row__title" title={report.title}>
                  {report.id} · {report.title}
                </div>
                <div className="artifact-row__meta">
                  <ScopeBadge scope={report.templateScope} />
                  {report.templateName && ` ${report.templateName}`} ·{' '}
                  {t('formsCount', { count: report.formIds.length })} ·{' '}
                  {t('findingsCount', { count: report.findingCount })} ·{' '}
                  {report.createdAt.slice(0, 10)}
                </div>
              </div>
              <div className="artifact-row__actions">
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  onClick={() => preview(report)}
                >
                  {t('preview')}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title={t('download')}
                  onClick={() => void download(report)}
                >
                  <Download size={13} strokeWidth={1.75} />
                </button>
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
          ))}
        </div>
      )}

      <GenerateReportDialog
        open={generating}
        formIds={selectedFormIds}
        onClose={() => setGenerating(false)}
      />
    </>
  );
}