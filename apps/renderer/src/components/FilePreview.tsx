import { useTranslation } from 'react-i18next';
import { ExternalLink, File as FileIcon, FolderSearch } from 'lucide-react';
import type { PreviewTab } from '../store/ui';

/**
 * 「预览」tab 内容。本期（布局）先提供文件头与「用系统程序打开 / 在文件夹中显示」，
 * 具体格式渲染在后续「文件预览」特性中接入。
 */
export function FilePreview({ target }: { target: PreviewTab }) {
  const { t } = useTranslation('preview');
  const { t: tc } = useTranslation('common');

  return (
    <div className="filepreview">
      <div className="filepreview__head">
        <FileIcon size={14} strokeWidth={1.75} />
        <span className="filepreview__name" title={target.path}>
          {target.name}
        </span>
        <span className="spacer" />
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
        <div className="panel-empty">
          <FileIcon size={26} strokeWidth={1.5} />
          <span>{t('placeholder')}</span>
          <span className="panel-hint">{tc('comingSoon')}</span>
        </div>
      </div>
    </div>
  );
}
