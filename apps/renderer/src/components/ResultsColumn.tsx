import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Finding } from '@fireeyeaud/shared';
import { useUiStore, type ResultsTab } from '../store/ui';
import { useFindingsStore } from '../store/findings';
import { useWorkspaceStore } from '../store/workspace';
import { FindingDetail } from './FindingDetail';

const TABS: ResultsTab[] = ['findings', 'graph', 'working-paper', 'evidence'];

const TAB_LABEL_KEY: Record<ResultsTab, string> = {
  findings: 'findings',
  graph: 'graph',
  'working-paper': 'workingPaper',
  evidence: 'evidence',
};

function FindingCard({ finding }: { finding: Finding }) {
  const { t: ts } = useTranslation('enums');
  const [open, setOpen] = useState(false);
  const title = finding.title?.text ?? finding.ruleKey ?? finding.id;
  const subjects = finding.subjects?.join('、') ?? '';
  const meta = [subjects, finding.amount].filter(Boolean).join(' · ');

  return (
    <div className={`finding${open ? ' finding--open' : ''}`}>
      <button
        type="button"
        className="finding__head"
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', padding: 0 }}
      >
        {open ? (
          <ChevronDown size={13} strokeWidth={1.75} />
        ) : (
          <ChevronRight size={13} strokeWidth={1.75} />
        )}
        <span className={`severity severity--${finding.severity}`}>
          {ts(`severity.${finding.severity}`)}
        </span>
        <span className="finding__id">{finding.id}</span>
        <span className="spacer" />
        <span className="finding__status">{ts(`status.${finding.status}`)}</span>
      </button>
      <div className="finding__title">{title}</div>
      {finding.description?.text && (
        <div className="finding__desc">{finding.description.text}</div>
      )}
      {meta && <div className="finding__meta">{meta}</div>}
      {open && <FindingDetail finding={finding} />}
    </div>
  );
}

function FindingsView() {
  const { t } = useTranslation('findings');
  const { t: tc } = useTranslation('common');
  const { t: te } = useTranslation('error');
  const items = useFindingsStore((s) => s.items);
  const loading = useFindingsStore((s) => s.loading);
  const errorKey = useFindingsStore((s) => s.errorKey);
  const load = useFindingsStore((s) => s.load);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const path = useWorkspaceStore((s) => s.path);

  useEffect(() => {
    void load();
  }, [load, path]);

  const count = (severity: string) =>
    items.filter((i) => i.severity === severity).length;

  return (
    <>
      <div className="stat-row" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="stat__value" style={{ color: 'var(--danger)' }}>
            {count('high')}
          </div>
          <div className="stat__label">{t('statsHigh')}</div>
        </div>
        <div className="stat">
          <div className="stat__value" style={{ color: 'var(--warning)' }}>
            {count('medium')}
          </div>
          <div className="stat__label">{t('statsMedium')}</div>
        </div>
        <div className="stat">
          <div className="stat__value" style={{ color: 'var(--info)' }}>
            {count('low')}
          </div>
          <div className="stat__label">{t('statsLow')}</div>
        </div>
      </div>

      {!workspace ? (
        <div className="panel-empty">
          <span>{tc('noWorkspace')}</span>
        </div>
      ) : errorKey ? (
        <div className="panel-error">{te(errorKey.replace(/^error\./, ''))}</div>
      ) : loading && items.length === 0 ? (
        <div className="panel-empty">
          <span>{tc('loading')}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="panel-empty">
          <span>{t('empty')}</span>
        </div>
      ) : (
        <div className="finding-list">
          {items.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </div>
      )}
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
