import { useTranslation } from 'react-i18next';
import {
  Braces,
  Database,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspace';

interface TreeEntry {
  label: string;
  folder?: boolean;
  depth: number;
  icon?: LucideIcon;
}

const TREE: TreeEntry[] = [
  { label: '数据文件', folder: true, depth: 0 },
  { label: '序时账.xlsx', depth: 1, icon: FileSpreadsheet },
  { label: '科目余额表.xlsx', depth: 1, icon: FileSpreadsheet },
  { label: '明细账.xlsx', depth: 1, icon: FileSpreadsheet },
  { label: '关联方清单.csv', depth: 1, icon: FileText },
  { label: '审计底稿', folder: true, depth: 0 },
  { label: 'FY-2025-03 疑点汇总.docx', depth: 1, icon: FileText },
  { label: '.fireeye', folder: true, depth: 0 },
  { label: 'config/', depth: 1, icon: Folder },
  { label: 'project.json', depth: 1, icon: Braces },
  { label: 'workspace.duckdb', depth: 1, icon: Database },
  { label: 'findings.jsonl', depth: 1, icon: Braces },
  { label: 'evidence.jsonl', depth: 1, icon: Braces },
  { label: 'rules.jsonl', depth: 1, icon: Braces },
  { label: 'checkpoints.sqlite', depth: 1, icon: Database },
  { label: '项目说明.md', depth: 0, icon: FileText },
];

export function ExplorerPanel() {
  const { t } = useTranslation('explorer');
  const { t: tc } = useTranslation('common');
  const { t: te } = useTranslation('error');
  const workspace = useWorkspaceStore((s) => s.workspace);
  const path = useWorkspaceStore((s) => s.path);
  const loading = useWorkspaceStore((s) => s.loading);
  const error = useWorkspaceStore((s) => s.error);
  const openFromDialog = useWorkspaceStore((s) => s.openFromDialog);

  if (!workspace) {
    return (
      <div className="panel-empty">
        <FolderOpen size={22} strokeWidth={1.5} />
        <span>{t('openFolderHint')}</span>
        <button
          type="button"
          className="button"
          onClick={() => void openFromDialog()}
          disabled={loading}
        >
          {loading ? tc('loading') : tc('openFolder')}
        </button>
        {error && <span className="panel-error">{te(error.messageKey.replace(/^error\./, ''))}</span>}
      </div>
    );
  }

  return (
    <div className="explorer">
      <div className="card">
        <div className="card__row">
          <Folder size={14} strokeWidth={1.75} />
          <span className="card__name">{workspace.name}</span>
        </div>
        <div className="card__meta">{path}</div>
      </div>
      <div className="tree">
        {TREE.map((entry) => {
          const Icon = entry.folder ? Folder : entry.icon ?? FileText;
          return (
            <div
              key={`${entry.depth}-${entry.label}`}
              className={`tree__row${entry.folder ? ' tree__row--folder' : ''}`}
              style={{ paddingLeft: 6 + entry.depth * 16 }}
            >
              <Icon size={14} strokeWidth={1.75} />
              <span>{entry.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
