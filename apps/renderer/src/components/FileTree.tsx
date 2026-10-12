import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  Trash2,
} from 'lucide-react';
import type { FsEntry } from '@fireeyeaud/shared';
import { useUiStore } from '../store/ui';
import { useConfirmStore } from '../store/confirm';

/** 删除错误码 → i18n key（error 命名空间）。 */
const DELETE_ERROR_KEYS: Record<string, string> = {
  E_PROTECTED: 'error.protected',
  E_DELETE_ROOT: 'error.deleteRoot',
  E_DELETE_FAILED: 'error.deleteFailed',
  E_NOT_FOUND: 'error.notFound',
  E_OUTSIDE_WORKSPACE: 'error.notFound',
};

interface TreeCallbacks {
  onDeleted: (path: string) => void;
  onError: (key: string) => void;
}

interface TreeNodeProps extends TreeCallbacks {
  entry: FsEntry;
  root: string;
  depth: number;
  refreshKey: number;
}

/** 单个文件/文件夹节点，目录按需展开（懒加载子项）。 */
function TreeNode({ entry, root, depth, refreshKey, onDeleted, onError }: TreeNodeProps) {
  const { t } = useTranslation('explorer');
  const { t: tc } = useTranslation('common');
  const openPreview = useUiStore((s) => s.openPreview);
  const confirm = useConfirmStore((s) => s.confirm);
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadChildren = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fireeyeaud?.readDir({ root, dir: entry.path });
      setChildren(res?.entries ?? []);
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [root, entry.path]);

  // 删除等操作后（refreshKey 变化）刷新已展开目录的子项。
  useEffect(() => {
    if (open) void loadChildren();
  }, [refreshKey, open, loadChildren]);

  const toggle = async () => {
    if (!entry.isDir) {
      openPreview(root, entry.path, entry.name);
      return;
    }
    const next = !open;
    setOpen(next);
    if (next && children === null) {
      await loadChildren();
    }
  };

  const handleDelete = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const confirmed = await confirm({
      title: t('delete'),
      message: t('deleteConfirm', { name: entry.name }),
      confirmLabel: t('delete'),
      cancelLabel: tc('cancel'),
      danger: true,
    });
    if (!confirmed) return;
    const res = await window.fireeyeaud?.deletePath({ root, path: entry.path });
    if (res?.ok) {
      onDeleted(entry.path);
    } else {
      onError(DELETE_ERROR_KEYS[res?.code ?? ''] ?? 'error.deleteFailed');
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
        <button
          type="button"
          className="tree__del"
          title={t('delete')}
          aria-label={t('delete')}
          onClick={(event) => void handleDelete(event)}
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
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
              refreshKey={refreshKey}
              onDeleted={onDeleted}
              onError={onError}
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
  onDeleted: (path: string) => void;
  onError: (key: string) => void;
}

export function FileTree({ root, refreshKey, onDeleted, onError }: FileTreeProps) {
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
        <TreeNode
          key={entry.path}
          entry={entry}
          root={root}
          depth={0}
          refreshKey={refreshKey}
          onDeleted={onDeleted}
          onError={onError}
        />
      ))}
    </div>
  );
}
