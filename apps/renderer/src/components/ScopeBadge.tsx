import { useTranslation } from 'react-i18next';
import type { ConfigScope } from '@fireeyeaud/shared';

export function ScopeBadge({ scope }: { scope: ConfigScope }) {
  const { t } = useTranslation('enums');
  return (
    <span className={`scope-badge scope-badge--${scope}`}>
      {t(`configScope.${scope}`)}
    </span>
  );
}
