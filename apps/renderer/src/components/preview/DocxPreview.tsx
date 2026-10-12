import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { renderAsync } from 'docx-preview';
import { base64ToBytes } from './util';

/** Word（.docx）预览：用 docx-preview 渲染为白纸页 DOM。 */
export function DocxPreview({ data, mime }: { data: string; mime: string }) {
  const { t } = useTranslation('preview');
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';
    setStatus('loading');

    (async () => {
      try {
        const bytes = base64ToBytes(data);
        const blob = new Blob([bytes], { type: mime });
        await renderAsync(blob, host, host, {
          className: 'docx',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
        });
        if (!cancelled) setStatus('ok');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data, mime]);

  return (
    <div className="docxpreview">
      <div className="preview-status">
        {status === 'loading' && (
          <>
            <Loader2 size={14} strokeWidth={2} className="spin" />
            <span>{t('loading')}</span>
          </>
        )}
        {status === 'error' && <span className="panel-error">{t('parseFailed')}</span>}
      </div>
      <div className="docxpreview__pages" ref={hostRef} />
    </div>
  );
}
