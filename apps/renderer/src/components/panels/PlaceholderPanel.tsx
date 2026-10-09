import { useTranslation } from 'react-i18next';
import { Construction } from 'lucide-react';

export function PlaceholderPanel() {
  const { t } = useTranslation('common');
  return (
    <div className="panel-empty">
      <Construction size={22} strokeWidth={1.5} />
      <span>{t('comingSoon')}</span>
    </div>
  );
}
