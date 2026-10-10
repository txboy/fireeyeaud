import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, FolderOpen } from 'lucide-react';
import type { WorkingPaperFormat } from '@fireeyeaud/shared';
import { useWorkingPaperStore } from '../store/workingPaper';
import { useWorkspaceStore } from '../store/workspace';
import { useUiStore } from '../store/ui';

const FORMATS: { format: WorkingPaperFormat; labelKey: string }[] = [
  { format: 'word', labelKey: 'exportWord' },
  { format: 'xlsx', labelKey: 'exportExcel' },
  { format: 'pdf', labelKey: 'exportPdf' },
];

export function WorkingPaperView() {
  const { t } = useTranslation('working-paper');
  const { t: tc } = useTranslation('common');
  const { t: te } = useTranslation('error');
  const items = useWorkingPaperStore((s) => s.items);
  const loading = useWorkingPaperStore((s) => s.loading);
  const busy = useWorkingPaperStore((s) => s.busy);
  const errorKey = useWorkingPaperStore((s) => s.errorKey);
  const load = useWorkingPaperStore((s) => s.load);
  const generate = useWorkingPaperStore((s) => s.generate);
  const path = useWorkspaceStore((s) => s.path);
  const selectedFindingId = useUiStore((s) => s.selectedFindingId);

  useEffect(() => {
    if (path) void load();
  }, [load, path]);

  const abs = (ref: string, file: string) =>
    [path, '.fireeye', 'artifacts', ref, file].join('/');

  const run = (format: WorkingPaperFormat, onlySelected: boolean) =>
    void generate(
      format,
      onlySelected && selectedFindingId ? [selectedFindingId] : undefined,
    );

  if (!path) {
    return (
      <div className="panel-empty">
        <span>{tc('noWorkspace')}</span>
      </div>
    );
  }

  return (
    <div className="wp-wrap">
      <div className="wp-toolbar">
        {FORMATS.map(({ format, labelKey }) => (
          <button
            key={format}
            type="button"
            className="button button--sm"
            disabled={busy}
            onClick={() => run(format, false)}
          >
            <FileText size={12} strokeWidth={2} /> {t(labelKey)}
          </button>
        ))}
        {selectedFindingId && (
          <button
            type="button"
            className="button button--sm button--ghost"
            disabled={busy}
            onClick={() => run('word', true)}
          >
            {t('exportSelected')}
          </button>
        )}
        {busy && <span className="wp-hint">{t('generating')}</span>}
      </div>

      {errorKey && (
        <div className="panel-error">{te(errorKey.replace(/^error\./, ''))}</div>
      )}

      <div className="wp-history__title">{t('history')}</div>
      {loading && items.length === 0 ? (
        <div className="panel-empty">
          <span>{tc('loading')}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="panel-empty">
          <span>{t('empty')}</span>
        </div>
      ) : (
        <div className="wp-list">
          {items.map((m) => (
            <div key={m.id} className="wp-item">
              <span className="wp-item__id">{m.id}</span>
              <span className="scope-badge">{t(`format.${m.format}`)}</span>
              <span className="wp-item__meta">
                {m.createdAt.slice(0, 19).replace('T', ' ')} ·{' '}
                {t('findingsCount', { count: m.findingIds.length })}
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="button button--sm"
                onClick={() =>
                  void window.fireeyeaud?.openPath(abs(m.artifactRef, m.files[0] ?? ''))
                }
              >
                {t('openFile')}
              </button>
              <button
                type="button"
                className="button button--sm button--ghost"
                onClick={() =>
                  void window.fireeyeaud?.showItemInFolder(
                    abs(m.artifactRef, m.files[0] ?? ''),
                  )
                }
              >
                <FolderOpen size={12} strokeWidth={2} /> {t('showInFolder')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
