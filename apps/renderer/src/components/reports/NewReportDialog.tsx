import { useEffect, useMemo, useState } from 'react';
import { Modal, message } from 'antd';
import { useTranslation } from 'react-i18next';
import type { EvidenceFormManifest, TemplateInfo } from '@fireeyeaud/shared';
import { createReportDraft, listTemplates } from '../../lib/api';
import { useReportsStore } from '../../store/reports';

/** 新建报告：选模板、勾选取证单、定标题，创建后直接进入写作台。 */
export function NewReportDialog({
  open,
  forms,
  onClose,
  onCreated,
}: {
  open: boolean;
  forms: EvidenceFormManifest[];
  onClose: () => void;
  onCreated: (reportId: string, title: string) => void;
}) {
  const { t } = useTranslation('report');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const reloadReports = useReportsStore((s) => s.load);

  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState(t('defaultTitle'));
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const template = useMemo(
    () => templates.find((item) => item.id === templateId),
    [templateId, templates],
  );

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setErrorKey(null);
    setSelected(forms.map((form) => form.id));
    setTitle(t('defaultTitle'));
    void listTemplates('report')
      .then((page) => {
        setTemplates(page.items);
        const preferred =
          page.items.find((item) => item.isDefault) ?? page.items[0];
        setTemplateId(preferred?.id ?? '');
      })
      .catch((err) => {
        setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
      });
  }, [open, forms]);

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );

  const submit = async () => {
    if (!template) {
      setErrorKey('error.templateRequired');
      return;
    }
    if (!title.trim()) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const doc = await createReportDraft({
        templateId: template.id,
        templateScope: template.scope,
        formIds: selected,
        title: title.trim(),
        header: { reportTitle: title.trim() },
      });
      await reloadReports();
      onCreated(doc.manifest.id, doc.body.title);
      void message.success(t('created'));
      onClose();
    } catch (err) {
      setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('createTitle')}
      centered
      width={560}
      onCancel={onClose}
      footer={[
        <button key="cancel" type="button" className="button button--ghost" onClick={onClose}>
          {tc('cancel')}
        </button>,
        <button
          key="ok"
          type="button"
          className="button"
          disabled={busy || !templateId}
          onClick={() => void submit()}
        >
          {busy ? t('creating') : t('create')}
        </button>,
      ]}
    >
      <div className="artifact-form">
        <label className="field">
          <span className="field__label">{t('titleLabel')}</span>
          <input
            className="searchbox"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">{t('template')}</span>
          <select
            className="searchbox"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            {templates.map((item) => (
              <option key={`${item.scope}:${item.id}`} value={item.id}>
                {item.name} · {item.scope === 'project' ? t('scopeProject') : t('scopeGlobal')}
              </option>
            ))}
          </select>
        </label>
        {templates.length === 0 && (
          <div className="card__meta">{t('noTemplate')}</div>
        )}

        <div className="field">
          <span className="field__label">{t('selectForms')}</span>
          {forms.length === 0 ? (
            <div className="card__meta">{t('noForms')}</div>
          ) : (
            <div className="artifact-select report-form-picker">
              {forms.map((form) => (
                <label key={form.id} className="artifact-select__item">
                  <input
                    type="checkbox"
                    checked={selected.includes(form.id)}
                    onChange={() => toggle(form.id)}
                  />
                  <span className="artifact-select__label">
                    {form.id} · {form.title}
                  </span>
                  <span className="card__meta">
                    {t('formFindings', { count: form.findingIds.length })}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {errorKey && (
          <div className="panel-error">
            {terr(errorKey.replace(/^error\./, ''))}
          </div>
        )}
      </div>
    </Modal>
  );
}
