import { Suspense, lazy, useEffect, useState } from 'react';
import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ArtifactPreview, FsFileContent } from '@fireeyeaud/shared';
import { useWorkspaceStore } from '../../store/workspace';

const DocxPreview = lazy(() =>
  import('../preview/DocxPreview').then((module) => ({ default: module.DocxPreview })),
);

export interface GeneratedDocPreviewProps {
  preview: ArtifactPreview | null;
  title: string;
  onTitleChange: (title: string) => void;
  saving?: boolean;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * 生成结果的预览弹窗：读暂存区的 document.docx 直接渲染。
 * 只有点「保存」才会落盘为 QZ-/RPT- 产物。
 */
export function GeneratedDocPreview({
  preview,
  title,
  onTitleChange,
  saving,
  onSave,
  onCancel,
}: GeneratedDocPreviewProps) {
  const { t } = useTranslation(preview?.kind === 'report' ? 'report' : 'evidence-form');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const wsPath = useWorkspaceStore((s) => s.path);

  const [content, setContent] = useState<FsFileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!preview || !wsPath) return;
    let cancelled = false;
    setContent(null);
    setError(null);
    setLoading(true);
    const api = window.fireeyeaud;
    if (!api?.readFile) {
      setError('error.opFailed');
      setLoading(false);
      return;
    }
    void api
      .readFile({ root: wsPath, path: `${wsPath}/${preview.relPath}` })
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.kind === 'base64') setContent(res);
        else setError('error.artifactNotFound');
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('error.artifactNotFound');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preview?.token, wsPath]);

  return (
    <Modal
      open={preview !== null}
      title={t('previewTitle')}
      centered
      width={960}
      onCancel={onCancel}
      destroyOnClose
      footer={[
        <button key="cancel" type="button" className="button button--ghost" onClick={onCancel}>
          {t('cancel')}
        </button>,
        <button
          key="save"
          type="button"
          className="button"
          disabled={saving || !title.trim() || Boolean(error)}
          onClick={onSave}
        >
          {t('save')}
        </button>,
      ]}
    >
      <div className="artifact-preview">
        <label className="field">
          <span className="field__label">
            {t(preview?.kind === 'report' ? 'reportTitle' : 'docTitle')}
          </span>
          <input
            className="searchbox"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </label>

        {preview && preview.warnings.length > 0 && (
          <div className="artifact-warnings">
            {preview.warnings.map((warning) => (
              <div key={warning} className="card__meta">
                · {warning}
              </div>
            ))}
          </div>
        )}

        <div className="artifact-preview__pages">
          {error ? (
            <div className="panel-error">{terr(error.replace(/^error\./, ''))}</div>
          ) : loading || !content ? (
            <div className="panel-empty">
              <span>{tc('loading')}</span>
            </div>
          ) : content.ok && content.kind === 'base64' ? (
            <Suspense fallback={<span className="card__meta">{tc('loading')}</span>}>
              <DocxPreview data={content.data} mime={content.mime} fitWidth />
            </Suspense>
          ) : (
            <div className="panel-empty">
              <span>{t('previewFailed')}</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}