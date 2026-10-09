import { useTranslation } from 'react-i18next';
import { useUiStore, type ResultsTab } from '../store/ui';

const TABS: ResultsTab[] = ['findings', 'graph', 'working-paper', 'evidence'];

const TAB_LABEL_KEY: Record<ResultsTab, string> = {
  findings: 'findings',
  graph: 'graph',
  'working-paper': 'workingPaper',
  evidence: 'evidence',
};

function FindingsView() {
  const { t } = useTranslation('findings');
  return (
    <>
      <div className="stat-row" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="stat__value" style={{ color: 'var(--danger)' }}>0</div>
          <div className="stat__label">{t('statsHigh')}</div>
        </div>
        <div className="stat">
          <div className="stat__value" style={{ color: 'var(--warning)' }}>0</div>
          <div className="stat__label">{t('statsMedium')}</div>
        </div>
        <div className="stat">
          <div className="stat__value" style={{ color: 'var(--info)' }}>0</div>
          <div className="stat__label">{t('statsLow')}</div>
        </div>
      </div>
      <div className="panel-empty">
        <span>{t('empty')}</span>
      </div>
    </>
  );
}

function EmptyView() {
  const { t } = useTranslation('results');
  return (
    <div className="panel-empty">
      <span>{t('empty')}</span>
    </div>
  );
}

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
        {resultsTab === 'findings' ? <FindingsView /> : <EmptyView />}
      </div>
    </aside>
  );
}
