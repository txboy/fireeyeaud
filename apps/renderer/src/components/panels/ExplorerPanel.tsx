import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Braces,
  Database,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspace';
import { useDatasourcesStore } from '../../store/datasources';

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
  const { t: ti } = useTranslation('import');
  const workspace = useWorkspaceStore((s) => s.workspace);
  const path = useWorkspaceStore((s) => s.path);
  const loading = useWorkspaceStore((s) => s.loading);
  const error = useWorkspaceStore((s) => s.error);
  const openFromDialog = useWorkspaceStore((s) => s.openFromDialog);

  const items = useDatasourcesStore((s) => s.items);
  const importing = useDatasourcesStore((s) => s.importing);
  const importError = useDatasourcesStore((s) => s.errorKey);
  const load = useDatasourcesStore((s) => s.load);
  const importFiles = useDatasourcesStore((s) => s.importFiles);

  useEffect(() => {
    if (workspace) void load();
  }, [workspace, load]);

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

      <div className="section-head">
        <span>{ti('title')}</span>
        <button
          type="button"
          className="button button--sm"
          onClick={() => void importFiles()}
          disabled={Boolean(importing)}
        >
          <Upload size={13} strokeWidth={1.9} />
          {ti('button')}
        </button>
      </div>

      {importing && (
        <div className="import-progress">
          <div className="import-progress__head">
            <span className="import-progress__name">
              {importing.path.split(/[\\/]/).pop()}
            </span>
            <span className="import-progress__phase">
              {ti(importing.phase === 'parse' ? 'parsing' : importing.phase === 'index' ? 'indexing' : 'loading')}
            </span>
          </div>
          <div className="progress">
            <div
              className="progress__bar"
              style={{
                width: `${
                  importing.total > 0
                    ? Math.round((importing.done / importing.total) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {importError && (
        <span className="panel-error">
          {te(importError.replace(/^error\./, ''))}
        </span>
      )}

      {items.length > 0 && (
        <div className="datasource-list">
          {items.map((ds) => (
            <div key={ds.id} className="card">
              <div className="card__row">
                <Database size={14} strokeWidth={1.75} />
                <span className="card__name">
                  {ds.path ? ds.path.split(/[\\/]/).pop() : ds.id}
                </span>
              </div>
              <div className="card__meta">
                {ti('tables', { count: ds.tables.length })}
              </div>
            </div>
          ))}
        </div>
      )}

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
