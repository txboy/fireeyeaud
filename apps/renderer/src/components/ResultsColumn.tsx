import { useTranslation } from 'react-i18next';
import { FindingsView } from './results/FindingsView';

/** 成果栏：只放「疑点」列表（归档与取证单由左侧活动栏进入）。 */
export function ResultsColumn() {
  const { t } = useTranslation('results');

  return (
    <aside className="results">
      <div className="results__title">{t('findings')}</div>
      <div className="results__body">
        <FindingsView />
      </div>
    </aside>
  );
}