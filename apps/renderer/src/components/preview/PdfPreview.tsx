import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { base64ToBytes } from './util';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** 单次最多渲染页数，避免超大 PDF 卡死。 */
const MAX_PAGES = 100;

/** PDF 预览：逐页渲染到 canvas，按容器宽度缩放。 */
export function PdfPreview({ data }: { data: string }) {
  const { t } = useTranslation('preview');
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';
    setStatus('loading');

    (async () => {
      try {
        const bytes = base64ToBytes(data);
        const task = pdfjs.getDocument({ data: bytes });
        const doc = await task.promise;
        if (cancelled) return;
        setTotal(doc.numPages);
        const pages = Math.min(doc.numPages, MAX_PAGES);
        for (let n = 1; n <= pages; n += 1) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const width = Math.max((host.clientWidth || 800) - 32, 200);
          const scale = width / base.width;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = 'pdfpage';
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          host.appendChild(canvas);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }
        if (!cancelled) setStatus('ok');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data]);

  return (
    <div className="pdfpreview">
      <div className="preview-status">
        {status === 'loading' && (
          <>
            <Loader2 size={14} strokeWidth={2} className="spin" />
            <span>{t('loading')}</span>
          </>
        )}
        {status === 'error' && <span className="panel-error">{t('parseFailed')}</span>}
        {status === 'ok' && total > MAX_PAGES && (
          <span className="panel-hint">{t('pageOf', { page: MAX_PAGES, total })}</span>
        )}
      </div>
      <div className="pdfpreview__pages" ref={hostRef} />
    </div>
  );
}
