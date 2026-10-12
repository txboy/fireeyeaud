import { useTranslation } from 'react-i18next';

/** 表单内的错误提示（errorKey 形如 `error.xxx`）。 */
export function FormError({ errorKey }: { errorKey: string | null }) {
  const { t } = useTranslation('error');
  if (!errorKey) return null;
  return <div className="panel-error">{t(errorKey.replace(/^error\./, ''))}</div>;
}
