import { Suspense, lazy, useEffect, useState } from 'react';
import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import type { FsFileContent, TemplateInfo } from '@fireeyeaud/shared';
import { getTemplateContent } from '../../lib/api';

// docx 渲染依赖较重，按需加载，避免模板面板首屏变慢。
const DocxPreview = lazy(() =>
  import('../preview/DocxPreview').then((module) => ({ default: module.DocxPreview })),
);

export interface TemplatePreviewModalProps {
  open: boolean;
  item: TemplateInfo | null;
  onClose: () => void;
}

/**
 * 模板原文件预览。
 *
 * 全局模板位于项目目录之外，渲染器无法用 fs:read-file 读取，因此统一走后端
 * `/templates/{id}/content` 内容接口（计划 §Task 6 Step 4）。
 */
export function TemplatePreviewModal({ open, item, onClose }: TemplatePreviewModalProps) {
  const { t } = useTranslation('templates');
  const [content, setContent] = useState<FsFileContent | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
    setContent(null);
    setFailed(false);
    void getTemplateContent(item.id, item.scope)
      .then((value) => {
        if (!cancelled) setContent(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, item?.id, item?.scope]);

  return (
    <Modal
      open={open}
      title={item?.name ?? t('preview')}
      centered
      width={920}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      {failed ? (
        <div className="panel-error">{t('previewFailed')}</div>
      ) : content?.ok && content.kind === 'base64' ? (
        <Suspense fallback={<div className="card__meta">{t('preview')}</div>}>
          <div className="tpl-preview">
            <DocxPreview data={content.data} mime={content.mime} />
          </div>
        </Suspense>
      ) : (
        <div className="panel-empty">
          <span>{t('preview')}</span>
        </div>
      )}
    </Modal>
  );
}