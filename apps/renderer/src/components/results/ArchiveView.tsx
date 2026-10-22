import { useTranslation } from 'react-i18next';
import { FileQuestion } from 'lucide-react';

/** 归档在后续计划实现；先保证 tab 可用。 */
export function ArchiveView() {
  const { t } = useTranslation('results');
  return (
    <div className="panel-empty">
      <FileQuestion size={22} strokeWidth={1.5} />
      <span>{t('empty')}</span>
    </div>
  );
}