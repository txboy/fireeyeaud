import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileDiff } from 'lucide-react';
import { useArchiveStore } from '../../store/archive';

/**
 * 右侧「变更文件」tab：某个归档包含的文件清单。
 * 业务类型清单取自归档时的 manifest 计数（列表接口只返回 git 文件状态）。
 */
export function ArchiveChangesTab({ archiveId }: { archiveId: string }) {
  const { t } = useTranslation('archive');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const changes = useArchiveStore((s) => s.changes);
  const loadChanges = useArchiveStore((s) => s.loadChanges);
  const history = useArchiveStore((s) => s.history);

  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErrorKey(null);
    loadChanges(archiveId)
      .catch((err: unknown) => {
        if (alive) {
          setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [archiveId, loadChanges]);

  const items = changes[archiveId] ?? [];
  const entry = history.find((item) => item.id === archiveId);

  return (
    <div className="archive-changes">
      <div className="archive-changes__head">
        <span className="archive-changes__title">
          <FileDiff size={14} strokeWidth={1.8} /> {t('changes')}
        </span>
        <span className="spacer" />
        <span className="card__meta">{archiveId}</span>
      </div>

      {entry?.manifest && (
        <div className="archive-changes__summary">
          <span>{t('countFindings', { count: entry.manifest.counts.findings })}</span>
          <span>{t('countEvidenceForms', { count: entry.manifest.counts.evidenceForms })}</span>
          <span>{t('countReports', { count: entry.manifest.counts.reports })}</span>
        </div>
      )}

      {errorKey && (
        <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
      )}

      {loading && items.length === 0 ? (
        <div className="tab-empty">
          <span>{tc('loading')}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="tab-empty">
          <span>{t('noChanges')}</span>
        </div>
      ) : (
        <ul className="archive-changes__list">
          {items.map((change) => (
            <li key={change.path} className="archive-changes__row">
              <span className="archive-changes__status">{change.status}</span>
              <span className="archive-changes__path">{change.path}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}