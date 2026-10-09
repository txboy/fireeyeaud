import { Braces, Database, FileSpreadsheet, FileText, Folder, type LucideIcon } from 'lucide-react';

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
  return (
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
  );
}
