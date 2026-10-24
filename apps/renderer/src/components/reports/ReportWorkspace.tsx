import { WorkspaceShell } from '../workspace/WorkspaceShell';
import { useReportsStore } from '../../store/reports';

/** 报告写作台：左侧对话、右侧结构化预览。 */
export function ReportWorkspace({ reportId }: { reportId: string }) {
  const reload = useReportsStore((s) => s.load);
  return <WorkspaceShell kind="report" id={reportId} reloadList={reload} />;
}