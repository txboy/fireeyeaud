import { useEffect, useState } from 'react';
import { Modal, message } from 'antd';
import { useTranslation } from 'react-i18next';
import type { EvidenceFormManifest } from '@fireeyeaud/shared';
import { useFormsStore } from '../../store/forms';
import { useWorkspaceStore } from '../../store/workspace';
import { useUiStore } from '../../store/ui';
import { useConfirmStore } from '../../store/confirm';
import { errorKeyOf } from '../../lib/errorKey';

/** 回执单：上传 / 替换 / 查看 / 删除（每个取证单最多一份）。 */
export function ReceiptDialog({
  form,
  open,
  onClose,
}: {
  form: EvidenceFormManifest | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('evidence-form');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const attach = useFormsStore((s) => s.attach);
  const clear = useFormsStore((s) => s.clear);
  const errorKey = useFormsStore((s) => s.errorKey);
  const wsPath = useWorkspaceStore((s) => s.path);
  const openPreview = useUiStore((s) => s.openPreview);
  const confirm = useConfirmStore((s) => s.confirm);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setNote(form?.receipt?.note ?? '');
  }, [open, form?.id, form?.receipt?.note]);

  const receipt = form?.receipt ?? null;

  const pick = async () => {
    const api = window.fireeyeaud;
    if (!api?.openFiles || !form) return;
    try {
      const [path] = await api.openFiles('receipts');
      if (!path) return;
      setBusy(true);
      await attach(form.id, path, note.trim() || undefined);
      void message.success(t('receiptUploaded'));
    } catch (err) {
      // store 已记录 errorKey（面板下方展示），这里再提示一次避免静默失败
      void message.error(
        terr((errorKeyOf(err)).replace(/^error\./, '')),
      );
    } finally {
      setBusy(false);
    }
  };

  const view = () => {
    if (!receipt || !wsPath) return;
    void openPreview(wsPath, `${wsPath}/${receipt.path}`, receipt.name);
  };

  const remove = async () => {
    if (!form) return;
    const ok = await confirm({
      title: t('removeReceipt'),
      message: t('deleteConfirm'),
      confirmLabel: tc('delete'),
      cancelLabel: tc('cancel'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await clear(form.id);
    } catch (err) {
      void message.error(
        terr((errorKeyOf(err)).replace(/^error\./, '')),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`${t('receipt')} · ${form?.id ?? ''}`}
      centered
      width={440}
      onCancel={onClose}
      footer={[
        <button key="close" type="button" className="button button--ghost" onClick={onClose}>
          {tc('close')}
        </button>,
      ]}
    >
      <div className="artifact-form">
        <label className="field">
          <span className="field__label">{t('receiptNote')}</span>
          <textarea
            className="searchbox"
            rows={2}
            value={note}
            placeholder={t('receiptNoteHint')}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        {receipt ? (
          <>
            <div className="artifact-row__title">{receipt.name}</div>
            <div className="card__meta">{receipt.path}</div>
            <div className="artifact-receipt__actions">
              <button type="button" className="button button--sm" onClick={view}>
                {t('viewReceipt')}
              </button>
              <button
                type="button"
                className="button button--sm button--ghost"
                disabled={busy}
                onClick={() => void pick()}
              >
                {t('replaceReceipt')}
              </button>
              <button
                type="button"
                className="button button--sm button--ghost"
                disabled={busy}
                onClick={() => void remove()}
              >
                {t('removeReceipt')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="card__meta">{t('receiptNone')}</div>
            <button
              type="button"
              className="button button--sm"
              disabled={busy || !form}
              onClick={() => void pick()}
            >
              {t('uploadReceipt')}
            </button>
          </>
        )}
        {errorKey && (
          <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
        )}
      </div>
    </Modal>
  );
}