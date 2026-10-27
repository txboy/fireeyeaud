import { useCallback, useEffect, useState } from 'react';
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
  const sharedErrorKey = store((s) => s.errorKey);
  const doc = store((s) => s.docs[id]);
  const loading = store((s) => Boolean(s.loading[id]));
  const load = store((s) => s.load);

  useEffect(() => {
    void load(id);
  }, [id, load]);

  // store 的 errorKey 是全局共享的：切换文档时可能还残留上一份文档的失败，
  // 只有「这次加载」确实报错才展示，避免把无关错误显示成「发生内部错误」。
  // 顺序：共享 errorKey 变化 → 标记失败；文档加载成功 → 清除。
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    if (sharedErrorKey) setLoadFailed(true);
  }, [sharedErrorKey]);
  useEffect(() => {
    if (doc) setLoadFailed(false);
  }, [doc]);

  const errorKey = loadFailed ? sharedErrorKey : null;

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