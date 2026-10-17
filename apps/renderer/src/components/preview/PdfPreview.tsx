import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { base64ToBytes } from './util';
import { CopyButton } from '../CopyButton';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** 单次最多渲染页数，避免超大 PDF 卡死。 */
const MAX_PAGES = 100;

/** PDF 预览：逐页渲染到 canvas，并叠加可框选复制的文本层，按容器宽度缩放。 */
export function PdfPreview({ data }: { data: string }) {
  const { t } = useTranslation('preview');
  const hostRef = useRef<HTMLDivElement>(null);
  const textRef = useRef('');
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';
    textRef.current = '';
    setStatus('loading');

    (async () => {
      try {
        const bytes = base64ToBytes(data);
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        setTotal(doc.numPages);
        const pages = Math.min(doc.numPages, MAX_PAGES);
        const collected: string[] = [];
        for (let n = 1; n <= pages; n += 1) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const width = Math.max((host.clientWidth || 800) - 32, 200);
          const scale = width / base.width;
          const viewport = page.getViewport({ scale });

          // 每页一个定位容器：canvas 在下、文本层绝对定位覆盖。
          const sheet = document.createElement('div');
          sheet.className = 'pdfpage-sheet';
          sheet.style.width = `${Math.floor(viewport.width)}px`;
          sheet.style.height = `${Math.floor(viewport.height)}px`;
          sheet.style.setProperty('--total-scale-factor', String(viewport.scale));

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = 'pdfpage';
          sheet.appendChild(canvas);

          const textDiv = document.createElement('div');
          textDiv.className = 'textLayer';
          sheet.appendChild(textDiv);
          host.appendChild(sheet);

          const ctx = canvas.getContext('2d');
          if (ctx) {
            await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          }
          if (cancelled) return;

          // 文本层：透明文本按坐标排布，支持鼠标框选复制；同时收集全文供「复制全文」。
          const textContent = await page.getTextContent();
          collected.push(
            textContent.items.map((item) => ('str' in item ? item.str : '')).join(''),
          );
          const layer = new pdfjs.TextLayer({
            textContentSource: textContent,
            container: textDiv,
            viewport,
          });
          await layer.render();
        }
        if (!cancelled) {
          textRef.current = collected.join('\n\n');
          setStatus('ok');
        }
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
        <span className="spacer" />
        {status === 'ok' && (
          <CopyButton title={t('copyAllText')} text={() => textRef.current} />
        )}
      </div>
      <div className="pdfpreview__pages" ref={hostRef} />
    </div>
  );
}
