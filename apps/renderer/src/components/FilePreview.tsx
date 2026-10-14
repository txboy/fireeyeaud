import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, message } from 'antd';
import { ExternalLink, File as FileIcon, FolderSearch, Loader2, Save } from 'lucide-react';
import type { FsFileContent } from '@fireeyeaud/shared';
import { setLeaveGuard, type PreviewTab } from '../store/ui';
import { useSettingsStore } from '../store/settings';
import { ImagePreview } from './preview/ImagePreview';
import { extOf, formatBytes } from './preview/util';

// 重依赖查看器按需加载（pdfjs / exceljs / docx-preview / codemirror）。
const TextPreview = lazy(() =>
  import('./preview/TextPreview').then((m) => ({ default: m.TextPreview })),
);
const PdfPreview = lazy(() =>
  import('./preview/PdfPreview').then((m) => ({ default: m.PdfPreview })),
);
const DocxPreview = lazy(() =>
  import('./preview/DocxPreview').then((m) => ({ default: m.DocxPreview })),
);
const SpreadsheetPreview = lazy(() =>
  import('./preview/SpreadsheetPreview').then((m) => ({ default: m.SpreadsheetPreview })),
);

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico']);
const DOCX_EXT = new Set(['.docx']);
const SHEET_EXT = new Set(['.xlsx', '.xlsm']);

function ViewerFallback() {
  return (
    <div className="panel-empty">
      <Loader2 size={22} strokeWidth={1.5} className="spin" />
    </div>
  );
}

/**
 * 「预览」tab 内容：按文件类型路由到对应查看器。
 * 文本可编辑（Ctrl+S / 保存按钮）；切换/关闭前若有未保存修改则弹确认。
 */
export function FilePreview({ target }: { target: PreviewTab }) {
  const { t } = useTranslation('preview');
  const { t: tc } = useTranslation('common');
  const theme = useSettingsStore((s) => s.theme);
  const dark = theme === 'dark';

  const [content, setContent] = useState<FsFileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const originalRef = useRef('');
  const textRef = useRef('');
  const dirtyRef = useRef(false);
  const resolverRef = useRef<((leave: boolean) => void) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setContent(null);
    setDirty(false);
    dirtyRef.current = false;
    const res = await window.fireeyeaud?.readFile({
      root: target.root,
      path: target.path,
    });
    const result: FsFileContent = res ?? { ok: false, code: 'E_READ_FAILED' };
    if (result.ok && result.kind === 'text') {
      setText(result.text);
      textRef.current = result.text;
      originalRef.current = result.text;
    }
    setContent(result);
    setLoading(false);
  }, [target.root, target.path]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (): Promise<boolean> => {
    const res = await window.fireeyeaud?.writeTextFile({
      root: target.root,
      path: target.path,
      text: textRef.current,
    });
    if (res?.ok) {
      originalRef.current = textRef.current;
      setDirty(false);
      dirtyRef.current = false;
      return true;
    }
    void message.error(t('readFailed'));
    return false;
  }, [target.root, target.path, t]);

  const changeText = useCallback((value: string) => {
    textRef.current = value;
    setText(value);
    const next = value !== originalRef.current;
    dirtyRef.current = next;
    setDirty(next);
  }, []);

  // 未保存守卫：切换文件 / 关闭 tab / 回会话前征询。
  useEffect(() => {
    setLeaveGuard(() => {
      if (!dirtyRef.current) return Promise.resolve(true);
      setConfirmOpen(true);
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
      });
    });
    return () => setLeaveGuard(null);
  }, []);

  const resolveLeave = (leave: boolean) => {
    setConfirmOpen(false);
    resolverRef.current?.(leave);
    resolverRef.current = null;
  };

  const name = target.name;
  const ext = extOf(name);
  const isText = content?.ok === true && content.kind === 'text';

  return (
    <div className="filepreview">
      <div className="filepreview__head">
        <FileIcon size={14} strokeWidth={1.75} />
        <span className="filepreview__name" title={target.path}>
          {name}
        </span>
        {dirty && <span className="filepreview__dirty">{t('unsaved')}</span>}
        <span className="spacer" />
        {isText && (
          <button
            type="button"
            className="button"
            onClick={() => void save()}
            disabled={!dirty}
          >
            <Save size={13} strokeWidth={1.9} />
            {t('save')}
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          title={t('showInFolder')}
          aria-label={t('showInFolder')}
          onClick={() => void window.fireeyeaud?.showItemInFolder(target.path)}
        >
          <FolderSearch size={14} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          className="icon-button"
          title={t('openExternally')}
          aria-label={t('openExternally')}
          onClick={() => void window.fireeyeaud?.openPath(target.path)}
        >
          <ExternalLink size={14} strokeWidth={1.9} />
        </button>
      </div>

      <div className="filepreview__body">
        <Suspense fallback={<ViewerFallback />}>
          {loading ? (
          <div className="panel-empty">
            <Loader2 size={22} strokeWidth={1.5} className="spin" />
            <span>{t('loading')}</span>
          </div>
        ) : !content ? null : !content.ok ? (
          <div className="panel-empty">
            <FileIcon size={26} strokeWidth={1.5} />
            <span>
              {content.code === 'E_UNSUPPORTED'
                ? t('unsupported')
                : content.code === 'E_TOO_LARGE'
                  ? t('tooLarge', { size: formatBytes(content.size ?? 0) })
                  : t('readFailed')}
            </span>
            <button
              type="button"
              className="button"
              onClick={() => void window.fireeyeaud?.openPath(target.path)}
            >
              {t('openExternally')}
            </button>
          </div>
        ) : content.kind === 'text' ? (
          <TextPreview
            key={target.path}
            initialValue={text}
            name={name}
            readOnly={false}
            dark={dark}
            line={target.line}
            column={target.column}
            onChange={changeText}
            onSave={() => void save()}
          />
        ) : IMAGE_EXT.has(ext) ? (
          <ImagePreview data={content.data} mime={content.mime} name={name} />
        ) : ext === '.pdf' ? (
          <PdfPreview data={content.data} />
        ) : DOCX_EXT.has(ext) ? (
          <DocxPreview data={content.data} mime={content.mime} />
        ) : SHEET_EXT.has(ext) ? (
          <SpreadsheetPreview data={content.data} />
        ) : (
          <div className="panel-empty">
            <FileIcon size={26} strokeWidth={1.5} />
            <span>{t('unsupported')}</span>
          </div>
        )}
        </Suspense>
      </div>

      <Modal
        open={confirmOpen}
        title={t('unsavedTitle')}
        closable={false}
        maskClosable={false}
        onCancel={() => resolveLeave(false)}
        footer={[
          <button
            key="cancel"
            type="button"
            className="button button--ghost"
            onClick={() => resolveLeave(false)}
          >
            {tc('cancel')}
          </button>,
          <button
            key="discard"
            type="button"
            className="button button--ghost"
            onClick={() => resolveLeave(true)}
          >
            {t('discard')}
          </button>,
          <button
            key="save"
            type="button"
            className="button"
            onClick={() => {
              void save().then((ok) => resolveLeave(ok));
            }}
          >
            {t('saveAndSwitch')}
          </button>,
        ]}
      >
        <p>{t('unsavedBody', { name })}</p>
      </Modal>
    </div>
  );
}
