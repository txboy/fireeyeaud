import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Trash2 } from 'lucide-react';
import { copyText } from '../lib/clipboard';
import { useChatStore, type ChatMessage } from '../store/chat';
import { useConfirmStore } from '../store/confirm';

/** 单条消息的操作条：复制原始内容 + 删除该条消息。 */
export function MessageActions({
  message,
  sessionId,
  disabled,
}: {
  message: ChatMessage;
  sessionId: string;
  disabled: boolean;
}) {
  const { t } = useTranslation('agent');
  const { t: tc } = useTranslation('common');
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const confirm = useConfirmStore((s) => s.confirm);
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    void copyText(message.content).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: t('deleteMessage'),
      message: t('deleteMessageConfirm'),
      confirmLabel: tc('delete'),
      cancelLabel: tc('cancel'),
      danger: true,
    });
    if (ok) await deleteMessage(sessionId, message.id);
  };

  return (
    <div className="msg__actions">
      {message.content && (
        <button
          type="button"
          className="msg__action"
          title={copied ? tc('copied') : tc('copy')}
          aria-label={tc('copy')}
          onClick={onCopy}
        >
          {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.9} />}
        </button>
      )}
      <button
        type="button"
        className="msg__action"
        title={t('deleteMessage')}
        aria-label={t('deleteMessage')}
        disabled={disabled}
        onClick={() => void onDelete()}
      >
        <Trash2 size={13} strokeWidth={1.9} />
      </button>
    </div>
  );
}
