import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
} from 'lucide-react';
import type { FsEntry } from '@fireeyeaud/shared';

interface TreeNodeProps {
  entry: FsEntry;
  root: string;
  depth: number;
}

/** 单个文件/文件夹节点，目录按需展开（懒加载子项）。 */
function TreeNode({ entry, root, depth }: TreeNodeProps) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (!entry.isDir) {
      void window.fireeyeaud?.openPath(entry.path);
      return;
    }
    const next = !open;
    setOpen(next);
    if (next && children === null) {
      setLoading(true);
      try {
        const res = await window.fireeyeaud?.readDir({ root, dir: entry.path });
        setChildren(res?.entries ?? []);
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
  };

  const Chevron = open ? ChevronDown : ChevronRight;
  const Icon = entry.isDir ? (open ? FolderOpen : Folder) : FileIcon;

  return (
    <>
      <div
        className={`tree__row${entry.isDir ? ' tree__row--folder' : ''}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={() => void toggle()}
        title={entry.name}
      >
        {entry.isDir ? (
          <Chevron size={13} strokeWidth={2} className="tree__chevron" />
        ) : (
          <span className="tree__chevron" />
        )}
        <Icon size={14} strokeWidth={1.75} />
        <span className="tree__label">{entry.name}</span>
      </div>
      {open && (
        <>
          {loading && (
            <div
              className="tree__row tree__row--muted"
              style={{ paddingLeft: 4 + (depth + 1) * 14 + 13 }}
            >
              …
            </div>
          )}
          {children?.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              root={root}
              depth={depth + 1}
            />
          ))}
        </>
      )}
    </>
  );
}

interface FileTreeProps {
  root: string;
  refreshKey: number;
}

export function FileTree({ root, refreshKey }: FileTreeProps) {
  const { t } = useTranslation('explorer');
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fireeyeaud?.readDir({ root, dir: root });
      setEntries(res?.entries ?? []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [root]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading && entries.length === 0) {
    return <div className="tree tree--empty">{t('loading')}</div>;
  }

  if (entries.length === 0) {
    return <div className="tree tree--empty">{t('noFiles')}</div>;
  }

  return (
    <div className="tree">
      {entries.map((entry) => (
        <TreeNode key={entry.path} entry={entry} root={root} depth={0} />
      ))}
    </div>
  );
}
