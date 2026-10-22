import { useEffect, useState } from 'react';
import { Modal, Radio } from 'antd';
import { useTranslation } from 'react-i18next';
import { FileUp } from 'lucide-react';
import { addFindingEvidenceApi, type AddEvidenceInput } from '../../lib/api';

/** 补充证据：上传文件 / 文字说明 / 手工核查记录。 */
export function AddEvidenceDialog({
  open,
  findingId,
  onClose,
  onAdded,
}: {
  open: boolean;
  findingId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useTranslation('findings');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');

  const [kind, setKind] = useState<AddEvidenceInput['kind']>('file');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind('file');
    setTitle('');
    setNote('');
    setPath('');
    setBusy(false);
    setErrorKey(null);
  }, [open]);

  const pick = async () => {
    const api = window.fireeyeaud;
    if (!api?.openFiles) {
      setErrorKey('error.opFailed');
      return;
    }
    try {
      const [selected] = await api.openFiles('attachments');
      if (selected) setPath(selected);
    } catch {
      setErrorKey('error.opFailed');
    }
  };

  const submit = async () => {
    const value = title.trim();
    if (!value) return;
    if (kind === 'file' && !path) {
      setErrorKey('error.fileRequired');
      return;
    }
    setBusy(true);
    setErrorKey(null);
    try {
      await addFindingEvidenceApi(findingId, {
        kind,
        title: value,
        note: note.trim() || undefined,
        ...(kind === 'file' ? { path } : {}),
      });
      onAdded();
      onClose();
    } catch (err) {
      setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
    } finally {
      setBusy(false);
    }
  };

  const noteLabel =
    kind === 'record' ? t('evidenceRecord') : t('evidenceNote');

  return (
    <Modal
      open={open}
      title={t('addEvidence')}
      centered
      width={460}
      onCancel={onClose}
      footer={[
        <button key="cancel" type="button" className="button button--ghost" onClick={onClose}>
          {tc('cancel')}
        </button>,
        <button
          key="ok"
          type="button"
          className="button"
          disabled={busy || !title.trim() || (kind === 'file' && !path)}
          onClick={() => void submit()}
        >
          {busy ? t('saving') : t('save')}
        </button>,
      ]}
    >
      <div className="artifact-form">
        <Radio.Group
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as AddEvidenceInput['kind']);
            setErrorKey(null);
          }}
        >
          <Radio value="file">{t('evidenceFile')}</Radio>
          <Radio value="text">{t('evidenceText')}</Radio>
          <Radio value="record">{t('evidenceRecord')}</Radio>
        </Radio.Group>

        {kind === 'file' && (
          <div className="field">
            <span className="field__label">{t('chooseFile')}</span>
            <div className="artifact-receipt__actions">
              <button
                type="button"
                className="button button--sm button--ghost"
                onClick={() => void pick()}
              >
                <FileUp size={12} strokeWidth={1.9} /> {t('chooseFile')}
              </button>
              <span className="card__meta">
                {path
                  ? t('fileChosen', { name: path.split(/[\\/]/).pop() })
                  : t('noFileChosen')}
              </span>
            </div>
          </div>
        )}

        <label className="field">
          <span className="field__label">{t('evidenceTitle')}</span>
          <input
            className="searchbox"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">{noteLabel}</span>
          <textarea
            className="searchbox"
            rows={kind === 'record' ? 5 : 3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        {errorKey && (
          <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
        )}
      </div>
    </Modal>
  );
}