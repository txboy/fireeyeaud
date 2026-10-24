import { useEffect, useMemo, useState } from 'react';
import { Modal, message } from 'antd';
import { useTranslation } from 'react-i18next';
import type { TemplateInfo } from '@fireeyeaud/shared';
import { listTemplates } from '../../lib/api';
import { useFormsStore } from '../../store/forms';
import { useFindingsStore } from '../../store/findings';

/** 新建取证单：选取证单模板 + 本轮勾选的疑点，创建后直接进入写作台。 */
export function NewEvidenceFormDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (formId: string, title: string) => void;
}) {
  const { t } = useTranslation('evidence-form');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const create = useFormsStore((s) => s.create);
  const selectedIds = useFindingsStore((s) => s.selectedIds);
  const findings = useFindingsStore((s) => s.items);

  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const selectedFindings = useMemo(
    () => findings.filter((finding) => selectedIds.includes(finding.id)),
    [findings, selectedIds],
  );

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setErrorKey(null);
    setTitle(t('defaultTitle'));
    void listTemplates('evidence-form')
      .then((page) => {
        setTemplates(page.items);
        const preferred = page.items.find((item) => item.isDefault) ?? page.items[0];
        setTemplateId(preferred?.id ?? '');
      })
      .catch((err) => {
        setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
      });
  }, [open, t]);

  const template = useMemo(
    () => templates.find((item) => item.id === templateId),
    [templateId, templates],
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
      const doc = await create({
        templateId: template.id,
        templateScope: template.scope,
        findingIds: selectedIds,
        title: title.trim(),
        header: { formTitle: title.trim() },
      });
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
        {templates.length === 0 && <div className="card__meta">{t('noTemplate')}</div>}

        <div className="field">
          <span className="field__label">{t('selectFindings')}</span>
          {selectedFindings.length === 0 ? (
            <div className="card__meta">{t('noSelection')}</div>
          ) : (
            <div className="artifact-select report-form-picker">
              {selectedFindings.map((finding) => (
                <label key={finding.id} className="artifact-select__item">
                  <input type="checkbox" checked readOnly />
                  <span className="artifact-select__label">
                    {finding.id} · {finding.title?.text || finding.ruleKey || ''}
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