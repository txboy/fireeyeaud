import { useTranslation } from 'react-i18next';
import { useUiStore, type ResultsTab } from '../store/ui';
import { FindingsView } from './results/FindingsView';
import { ArchiveView } from './results/ArchiveView';

const TABS: ResultsTab[] = ['findings', 'archive'];

const TAB_LABEL_KEY: Record<ResultsTab, string> = {
  findings: 'findings',
  archive: 'archive',
};

/** 成果栏：疑点 / 归档（取证单改由左侧活动栏进入）。 */
export function ResultsColumn() {
  const { t } = useTranslation('results');
  const resultsTab = useUiStore((s) => s.resultsTab);
  const setResultsTab = useUiStore((s) => s.setResultsTab);

  return (
    <aside className="results">
      <div className="results__tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`results__tab${resultsTab === tab ? ' results__tab--active' : ''}`}
            onClick={() => setResultsTab(tab)}
          >
            {t(TAB_LABEL_KEY[tab])}
          </button>
        ))}
      </div>
      <div className="results__body">
        {resultsTab === 'findings' ? <FindingsView /> : <ArchiveView />}
      </div>
    </aside>
  );
}