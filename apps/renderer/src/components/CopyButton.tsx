import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../lib/clipboard';

/** 通用「复制到剪贴板」图标按钮：点击后短暂显示对勾反馈。 */
export function CopyButton({
  text,
  title,
  disabled,
}: {
  text: string | (() => string);
  title?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation('common');
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    const value = typeof text === 'function' ? text() : text;
    if (!value) return;
    void copyText(value).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      className="icon-button"
      title={copied ? t('copied') : (title ?? t('copy'))}
      aria-label={title ?? t('copy')}
      disabled={disabled}
      onClick={onCopy}
    >
      {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.9} />}
    </button>
  );
}
