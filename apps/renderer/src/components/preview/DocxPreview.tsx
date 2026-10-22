import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { renderAsync } from 'docx-preview';
import { base64ToBytes } from './util';
import { CopyButton } from '../CopyButton';

/**
 * Word（.docx）预览：用 docx-preview 渲染为白纸页 DOM。
 *
 * `fitWidth` 开启后按容器宽度缩放页面，避免窄容器里出现横向滚动条
 * （模板表单的预览区使用；独立预览 tab 保持原样）。
 */
export function DocxPreview({
  data,
  mime,
  fitWidth = false,
}: {
  data: string;
  mime: string;
  fitWidth?: boolean;
}) {
  const { t } = useTranslation('preview');
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';
    setStatus('loading');

    let observer: ResizeObserver | null = null;

    /** 把页面缩放到容器宽度（zoom 会重排，纵向高度自动跟随）。 */
    const fit = () => {
      if (!fitWidth) return;
      const wrapper = host.querySelector<HTMLElement>('.docx-wrapper');
      const page = host.querySelector<HTMLElement>('section.docx');
      if (!wrapper || !page) return;
      // 先还原再测量，避免缩放值累积
      wrapper.style.zoom = '1';
      const natural = page.offsetWidth;
      const available = host.clientWidth - 32; // 容器左右内边距
      if (natural <= 0 || available <= 0) return;
      wrapper.style.zoom = String(Math.min(1, available / natural));
    };

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
        if (cancelled) return;
        setStatus('ok');
        fit();
        if (fitWidth && typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => fit());
          observer.observe(host);
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [data, mime, fitWidth]);

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
        <span className="spacer" />
        {status === 'ok' && (
          <CopyButton
            title={t('copyAllText')}
            text={() => hostRef.current?.innerText ?? ''}
          />
        )}
      </div>
      <div className="docxpreview__pages" ref={hostRef} />
    </div>
  );
}