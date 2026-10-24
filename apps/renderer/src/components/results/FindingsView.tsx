import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCheck2, Plus, X } from 'lucide-react';
import { FindingCard } from './FindingCard';
import { NewFindingDialog } from './NewFindingDialog';
import { NewEvidenceFormDialog } from '../forms/NewEvidenceFormDialog';
import { useFindingsStore } from '../../store/findings';
import { useWorkspaceStore } from '../../store/workspace';
import { useUiStore } from '../../store/ui';

/** 疑点列表：统计、新建、多选、删除、详情。 */
export function FindingsView() {
  const { t } = useTranslation('findings');
  const { t: tform } = useTranslation('evidence-form');
  const { t: tc } = useTranslation('common');
  const { t: te } = useTranslation('error');
  const items = useFindingsStore((s) => s.items);
  const loading = useFindingsStore((s) => s.loading);
  const errorKey = useFindingsStore((s) => s.errorKey);
  const selectedIds = useFindingsStore((s) => s.selectedIds);
  const load = useFindingsStore((s) => s.load);
  const clearSelected = useFindingsStore((s) => s.clearSelected);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const path = useWorkspaceStore((s) => s.path);
  const openEvidenceForm = useUiStore((s) => s.openEvidenceForm);

  const [creating, setCreating] = useState(false);
  const [generatingForm, setGeneratingForm] = useState(false);

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

      <div className="findings-toolbar">
        <button
          type="button"
          className="button button--sm button--ghost"
          onClick={() => setGeneratingForm(true)}
        >
          <FileCheck2 size={12} strokeWidth={1.9} /> {tform('newForm')}
        </button>
        <button
          type="button"
          className="button button--sm"
          onClick={() => setCreating(true)}
        >
          <Plus size={12} strokeWidth={2} /> {t('addFinding')}
        </button>
        <span className="spacer" />
        {selectedIds.length > 0 && (
          <>
            <span className="card__meta">
              {t('selected', { count: selectedIds.length })}
            </span>
            <button
              type="button"
              className="button button--sm button--ghost"
              onClick={clearSelected}
            >
              <X size={11} strokeWidth={2} /> {t('clearSelection')}
            </button>
          </>
        )}
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
          {items.map((finding) => (
            <FindingCard key={finding.id} finding={finding} />
          ))}
        </div>
      )}

      <NewFindingDialog open={creating} onClose={() => setCreating(false)} />
      <NewEvidenceFormDialog
        open={generatingForm}
        onClose={() => setGeneratingForm(false)}
        onCreated={(formId, title) => {
          void openEvidenceForm(formId, title);
        }}
      />
    </>
  );
}