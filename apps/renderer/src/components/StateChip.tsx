import { useTranslation } from 'react-i18next';

/** 「启用 / 停用」状态肩标。 */
export function StateChip({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation('common');
  return (
    <span className={`state-chip state-chip--${enabled ? 'on' : 'off'}`}>
      {enabled ? t('enable') : t('disable')}
    </span>
  );
}
