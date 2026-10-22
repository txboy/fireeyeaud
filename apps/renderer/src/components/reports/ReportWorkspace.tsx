import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { ReportChat } from './ReportChat';
import { ReportPreview } from './ReportPreview';
import { useReportDocStore } from '../../store/reportWorkspace';

/** 报告写作台：左侧对话、右侧结构化预览。 */
export function ReportWorkspace({ reportId }: { reportId: string }) {
  const { t } = useTranslation('report');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const doc = useReportDocStore((s) => s.docs[reportId]);
  const loading = useReportDocStore((s) => s.loading[reportId]);
  const errorKey = useReportDocStore((s) => s.errorKey);
  const load = useReportDocStore((s) => s.load);

  useEffect(() => {
    void load(reportId);
  }, [load, reportId]);

  const refresh = useCallback(() => {
    void load(reportId);
  }, [load, reportId]);

  if (!doc) {
    return (
      <div className="panel-empty">
        <FileText size={22} strokeWidth={1.5} />
        <span>{loading ? tc('loading') : t('empty')}</span>
        {errorKey && <span className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</span>}
      </div>
    );
  }

  return (
    <div className="report-workspace">
      <ReportChat reportId={reportId} onChanged={refresh} />
      <ReportPreview doc={doc} onRefresh={refresh} />
    </div>
  );
}
