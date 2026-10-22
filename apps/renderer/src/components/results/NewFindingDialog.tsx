import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, message } from 'antd';
import type { Severity } from '@fireeyeaud/shared';
import { useFindingsStore } from '../../store/findings';

/** 人工新建疑点。 */
export function NewFindingDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('findings');
  const { t: te } = useTranslation('enums');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const create = useFindingsStore((s) => s.create);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [subjects, setSubjects] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setSeverity('medium');
    setSubjects('');
    setAmount('');
    setCurrency('CNY');
    setBusy(false);
    setErrorKey(null);
  }, [open]);

  const submit = async () => {
    const value = title.trim();
    if (!value) return;
    setBusy(true);
    setErrorKey(null);
    try {
      await create({
        title: value,
        description: description.trim() || undefined,
        severity,
        subjects: subjects
          .split(/[,，、]/)
          .map((item) => item.trim())
          .filter(Boolean),
        amount: amount.trim() || undefined,
        currency,
        author: '审计员',
      });
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
      title={t('addFinding')}
      centered
      width={480}
      onCancel={onClose}
      footer={[
        <button key="cancel" type="button" className="button button--ghost" onClick={onClose}>
          {tc('cancel')}
        </button>,
        <button
          key="ok"
          type="button"
          className="button"
          disabled={busy || !title.trim()}
          onClick={() => void submit()}
        >
          {busy ? t('saving') : t('save')}
        </button>,
      ]}
    >
      <div className="artifact-form">
        <label className="field">
          <span className="field__label">{t('newTitle')}</span>
          <input
            className="searchbox"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">{t('description')}</span>
          <textarea
            className="searchbox"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">{t('severity')}</span>
          <select
            className="searchbox"
            value={severity}
            onChange={(event) => setSeverity(event.target.value as Severity)}
          >
            <option value="high">{te('severity.high')}</option>
            <option value="medium">{te('severity.medium')}</option>
            <option value="low">{te('severity.low')}</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">{t('subjects')}</span>
          <input
            className="searchbox"
            value={subjects}
            onChange={(event) => setSubjects(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">{t('amount')}</span>
          <div className="artifact-receipt__actions">
            <input
              className="searchbox"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <select
              className="searchbox"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              <option value="CNY">CNY</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="HKD">HKD</option>
              <option value="JPY">JPY</option>
            </select>
          </div>
        </label>
        {errorKey && (
          <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
        )}
      </div>
    </Modal>
  );
}