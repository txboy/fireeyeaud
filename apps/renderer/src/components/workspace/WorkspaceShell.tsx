import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { WorkspaceChat } from './WorkspaceChat';
import { WorkspacePreview } from './WorkspacePreview';
import { useDocStore } from '../../store/workspaceDocs';
import type { WorkspaceKind } from '../../store/workspaceKind';

/** 写作台外壳：左侧对话、右侧结构化预览；报告与取证单共用。 */
export function WorkspaceShell({
  kind,
  id,
  reloadList,
}: {
  kind: WorkspaceKind;
  id: string;
  /** 写入后刷新左侧记录列表（报告列表 / 取证单列表）。 */
  reloadList?: () => void;
}) {
  const { t } = useTranslation(kind === 'report' ? 'report' : 'evidence-form');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  // useDocStore 按 kind 返回同一个 selector hook，kind 不变时 hook 身份不变。
  const store = useDocStore(kind);
  const doc = store((s) => s.docs[id]);
  const loading = store((s) => Boolean(s.loading[id]));
  const errorKey = store((s) => s.errorKey);
  const load = store((s) => s.load);

  useEffect(() => {
    void load(id);
  }, [id, load]);

  const refresh = useCallback(() => {
    void load(id);
    reloadList?.();
  }, [id, load, reloadList]);

  if (!doc) {
    return (
      <div className="panel-empty">
        <FileText size={22} strokeWidth={1.5} />
        <span>{loading ? tc('loading') : t('emptySections')}</span>
        {errorKey && (
          <span className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</span>
        )}
      </div>
    );
  }

  const selectedIds =
    'selectedFormIds' in doc.body
      ? doc.body.selectedFormIds
      : 'selectedFindingIds' in doc.body
        ? doc.body.selectedFindingIds
        : [];

  return (
    <div className="report-workspace">
      <WorkspaceChat kind={kind} id={id} selectedIds={selectedIds} onChanged={refresh} />
      <WorkspacePreview kind={kind} doc={doc} onRefresh={refresh} />
    </div>
  );
}