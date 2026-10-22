import { useEffect, useState } from 'react';
import { Modal, message } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ArtifactPreview } from '@fireeyeaud/shared';
import { useReportsStore } from '../../store/reports';
import { useWorkspaceStore } from '../../store/workspace';
import { GeneratedDocPreview } from './GeneratedDocPreview';
import { HeaderFields, today, toHeaderPayload, type HeaderValues } from './HeaderFields';
import { TemplatePicker, type TemplateChoice } from './TemplatePicker';

/** 生成项目报告：选报告模板 + 抬头字段 → 预览 → 保存。 */
export function GenerateReportDialog({
  open,
  formIds,
  onClose,
}: {
  open: boolean;
  formIds: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation('report');
  const { t: terr } = useTranslation('error');
  const workspace = useWorkspaceStore((s) => s.workspace);
  const previewReport = useReportsStore((s) => s.preview);
  const commit = useReportsStore((s) => s.commit);

  const [template, setTemplate] = useState<TemplateChoice | null>(null);
  const [title, setTitle] = useState('');
  const [header, setHeader] = useState<HeaderValues>({
    projectName: '',
    projectCode: '',
    auditee: '',
    period: '',
    preparedBy: '',
    reviewedBy: '',
    date: today(),
  });
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArtifactPreview | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setErrorKey(null);
    setBusy(false);
    setSaving(false);
    setTemplate(null);
    // 标题属于本次生成：不重置会把上一份的标题带进新报告
    setTitle('');
    setHeader((prev) => ({
      ...prev,
      projectName: prev.projectName || workspace?.name || '',
      date: prev.date || today(),
    }));
  }, [open, workspace?.name]);

  const runPreview = async () => {
    if (!template || formIds.length === 0) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const result = await previewReport({
        templateId: template.id,
        templateScope: template.scope,
        formIds,
        header: toHeaderPayload(header, { reportTitle: title.trim() }),
      });
      setPreview(result);
      setTitle((prev) => prev || result.suggestedTitle);
    } catch (err) {
      setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      await commit(preview.token, title.trim() || preview.suggestedTitle);
      void message.success(t('saved'));
      setPreview(null);
      onClose();
    } catch (err) {
      setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={open && preview === null}
        title={t('generate')}
        centered
        width={640}
        onCancel={onClose}
        footer={[
          <button key="cancel" type="button" className="button button--ghost" onClick={onClose}>
            {t('cancel')}
          </button>,
          <button
            key="preview"
            type="button"
            className="button"
            disabled={busy || !template || formIds.length === 0}
            onClick={() => void runPreview()}
          >
            {t('preview')}
          </button>,
        ]}
      >
        <div className="artifact-form">
          <div className="card__meta">
            {formIds.length > 0
              ? t('selectedForms', { count: formIds.length })
              : t('noSelection')}
          </div>

          <TemplatePicker kind="report" value={template} onChange={setTemplate} />

          <label className="field">
            <span className="field__label">{t('reportTitle')}</span>
            <input
              className="searchbox"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <div className="artifact-form__section">{t('header')}</div>
          <HeaderFields ns="report" value={header} onChange={setHeader} />

          {errorKey && (
            <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
          )}
        </div>
      </Modal>

      <GeneratedDocPreview
        preview={preview}
        title={title}
        onTitleChange={setTitle}
        saving={saving}
        onSave={() => void save()}
        onCancel={() => setPreview(null)}
      />
    </>
  );
}