import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  File as FileIcon,
  FolderClosed,
  FolderOpen,
} from 'lucide-react';
import type { FsEntry } from '@fireeyeaud/shared';
import { dbDriverFor } from '../lib/db-file';
import { WORKSPACE_DRAG_ENTRY, WORKSPACE_DRAG_PATH } from '../lib/dnd';
import { useUiStore } from '../store/ui';
import { useConfirmStore } from '../store/confirm';
import { usePromptStore } from '../store/prompt';
import { useDatasourcesStore } from '../store/datasources';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

/** 可「导入数据」的表格文件后缀。 */
const TABLE_EXT = new Set(['.csv', '.txt', '.xlsx', '.xlsm']);

/** 导入错误码 → error 命名空间 key。 */
const IMPORT_ERROR_KEYS: Record<string, string> = {
  E_IMPORT_PARSE: 'importParse',
  E_IMPORT_DUP: 'importDup',
  E_PATH_INVALID: 'pathInvalid',
  E_READ_FAILED: 'internal',
};
/** 树内拖拽的自定义 MIME。 */
const DRAG_TYPE = WORKSPACE_DRAG_PATH;

/** 文件操作错误码 → i18n key（error 命名空间）。 */
const OP_ERROR_KEYS: Record<string, string> = {
  E_PROTECTED: 'error.protected',
  E_INVALID_NAME: 'error.invalidName',
  E_EXISTS: 'error.nameExists',
  E_INTO_SELF: 'error.intoSelf',
  E_NOT_FOUND: 'error.notFound',
  E_OUTSIDE_WORKSPACE: 'error.notFound',
  E_ROOT: 'error.invalidName',
  E_OP_FAILED: 'error.opFailed',
  E_DELETE_FAILED: 'error.deleteFailed',
  E_DELETE_ROOT: 'error.deleteRoot',
};

function isTableFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && TABLE_EXT.has(name.slice(dot).toLowerCase());
}

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function parentDir(filePath: string): string {
  return filePath.replace(/[\\/][^\\/]*$/, '');
}

interface MenuState {
  x: number;
  y: number;
  entry: FsEntry | null;
  isRoot: boolean;
  protectedPath: boolean;
}

interface TreeApi {
  root: string;
  refreshKey: number;
  selectedDir: string;
  dropDir: string | null;
  onSelectDir: (path: string) => void;
  onRefresh: () => void;
  onDeleted: (path: string) => void;
  onError: (key: string) => void;
  onImportData: (path: string) => void;
  /** 点击数据库文件：附加到数据库或跳转其授权页。 */
  onOpenDatabase: (path: string, name: string) => void;
  onUpload: () => void;
  setDropDir: (path: string | null) => void;
  openMenu: (
    event: ReactMouseEvent,
    entry: FsEntry,
    isRoot: boolean,
    protectedPath: boolean,
  ) => void;
  dropOn: (targetDir: string, event: DragEvent) => void;
}

interface TreeNodeProps {
  entry: FsEntry;
  depth: number;
  isRoot: boolean;
  /** `.fireeye` 目录及其内部：不可拖拽、不可作为放置目标。 */
  protectedPath: boolean;
  api: TreeApi;
}

/** 单个文件/文件夹节点，目录按需展开（懒加载子项）。 */
function TreeNode({ entry, depth, isRoot, protectedPath, api }: TreeNodeProps) {
  const openPreview = useUiStore((s) => s.openPreview);
  const { t } = useTranslation('explorer');
  const { t: te } = useTranslation('error');
  // 该文件最近一次自动/手动导入失败的标识（路径 → 错误码）。
  const failCode = useDatasourcesStore((s) => s.importFailed[entry.path]);
  const [open, setOpen] = useState(isRoot);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadChildren = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fireeyeaud?.readDir({ root: api.root, dir: entry.path });
      setChildren(res?.entries ?? []);
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [api.root, entry.path]);

  // 文件操作后（refreshKey 变化）刷新已展开目录的子项。
  useEffect(() => {
    if (open) void loadChildren();
  }, [api.refreshKey, open, loadChildren]);

  const toggle = async () => {
    if (!entry.isDir) {
      if (dbDriverFor(entry.name)) {
        api.onOpenDatabase(entry.path, entry.name);
        return;
      }
      openPreview(api.root, entry.path, entry.name);
      return;
    }
    const next = !open;
    setOpen(next);
    if (next && children === null) await loadChildren();
  };

  const onRowClick = () => {
    if (entry.isDir) api.onSelectDir(entry.path);
    void toggle();
  };

  const onDragStart = (event: DragEvent) => {
    event.stopPropagation();
    event.dataTransfer.setData(DRAG_TYPE, entry.path);
    // 额外携带元数据，供聊天输入框判断文件 / 目录。
    event.dataTransfer.setData(
      WORKSPACE_DRAG_ENTRY,
      JSON.stringify({ path: entry.path, name: entry.name, isDir: entry.isDir }),
    );
    event.dataTransfer.effectAllowed = 'copyMove';
  };

  const onDragOver = (event: DragEvent) => {
    if (protectedPath) return;
    const types = event.dataTransfer.types;
    if (!types.includes(DRAG_TYPE) && !types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    api.setDropDir(entry.path);
  };

  const onDrop = (event: DragEvent) => {
    if (protectedPath) return;
    event.preventDefault();
    event.stopPropagation();
    api.dropOn(entry.isDir ? entry.path : parentDir(entry.path), event);
  };

  const Icon = entry.isDir ? (open ? FolderOpen : FolderClosed) : FileIcon;
  const selected = entry.isDir && entry.path === api.selectedDir;
  const dropTarget = api.dropDir === entry.path;

  return (
    <>
      <div
        className={`tree__row${entry.isDir ? ' tree__row--folder' : ''}${
          selected ? ' tree__row--selected' : ''
        }${dropTarget ? ' tree__row--drop' : ''}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={onRowClick}
        onContextMenu={(event) => api.openMenu(event, entry, isRoot, protectedPath)}
        draggable={!isRoot && !protectedPath}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        title={entry.path}
      >
        <Icon size={14} strokeWidth={1.75} />
        <span className="tree__label">{entry.name}</span>
        {failCode && (
          <span
            className="tree__fail"
            title={`${t('importFailed')}: ${te(IMPORT_ERROR_KEYS[failCode] ?? 'internal')}`}
          >
            <AlertTriangle size={12} strokeWidth={2} />
          </span>
        )}
      </div>
      {open && (
        <>
          {loading && (
            <div
              className="tree__row tree__row--muted"
              style={{ paddingLeft: 4 + (depth + 1) * 14 }}
            >
              …
            </div>
          )}
          {children?.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              isRoot={false}
              protectedPath={protectedPath || child.name === '.fireeye'}
              api={api}
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
  selectedDir: string;
  onSelectDir: (path: string) => void;
  onRefresh: () => void;
  onDeleted: (path: string) => void;
  onError: (key: string) => void;
  onImportData: (path: string) => void;
  /** 点击数据库文件：附加到数据库或跳转其授权页。 */
  onOpenDatabase: (path: string, name: string) => void;
  onUpload: () => void;
}

export function FileTree({
  root,
  refreshKey,
  selectedDir,
  onSelectDir,
  onRefresh,
  onDeleted,
  onError,
  onImportData,
  onOpenDatabase,
  onUpload,
}: FileTreeProps) {
  const { t } = useTranslation('explorer');
  const { t: tc } = useTranslation('common');
  const confirm = useConfirmStore((s) => s.confirm);
  const promptName = usePromptStore((s) => s.prompt);
  const [dropDir, setDropDir] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const fail = useCallback(
    (code?: string) => onError(OP_ERROR_KEYS[code ?? ''] ?? 'error.opFailed'),
    [onError],
  );

  const dropOn = useCallback(
    async (targetDir: string, event: DragEvent) => {
      setDropDir(null);
      const internal = event.dataTransfer.getData(DRAG_TYPE);
      if (internal) {
        if (internal === targetDir || parentDir(internal) === targetDir) return;
        const res = await window.fireeyeaud?.movePath({ root, sourcePath: internal, targetDir });
        if (res?.ok) onRefresh();
        else fail(res?.code);
        return;
      }
      const files = Array.from(event.dataTransfer.files);
      const paths = files
        .map((file) => window.fireeyeaud?.getPathForFile(file))
        .filter((value): value is string => Boolean(value));
      if (paths.length === 0) return;
      const res = await window.fireeyeaud?.copyFiles({ root, targetDir, sourcePaths: paths });
      if (res?.ok) onRefresh();
      else fail(res?.code);
    },
    [root, onRefresh, fail],
  );

  const openMenu = useCallback(
    (event: ReactMouseEvent, entry: FsEntry, isRoot: boolean, protectedPath: boolean) => {
      event.preventDefault();
      event.stopPropagation();
      if (protectedPath) return;
      setMenu({ x: event.clientX, y: event.clientY, entry, isRoot, protectedPath });
    },
    [],
  );

  const api: TreeApi = {
    root,
    refreshKey,
    selectedDir,
    dropDir,
    onSelectDir,
    onRefresh,
    onDeleted,
    onError,
    onImportData,
    onOpenDatabase,
    onUpload,
    setDropDir,
    openMenu,
    dropOn: (targetDir, event) => void dropOn(targetDir, event),
  };

  const createFolder = async (parent: string) => {
    const name = await promptName({
      title: t('newFolder'),
      label: t('nameLabel'),
      confirmLabel: tc('confirm'),
      cancelLabel: tc('cancel'),
    });
    if (!name) return;
    const res = await window.fireeyeaud?.createDir({ root, parentDir: parent, name });
    if (res?.ok) onRefresh();
    else fail(res?.code);
  };

  const createFile = async (parent: string) => {
    const name = await promptName({
      title: t('newFile'),
      label: t('nameLabel'),
      confirmLabel: tc('confirm'),
      cancelLabel: tc('cancel'),
    });
    if (!name) return;
    const res = await window.fireeyeaud?.createFile({ root, parentDir: parent, name });
    if (res?.ok) onRefresh();
    else fail(res?.code);
  };

  const doRename = async (entry: FsEntry) => {
    const name = await promptName({
      title: t('rename'),
      label: t('nameLabel'),
      defaultValue: entry.name,
      confirmLabel: tc('confirm'),
      cancelLabel: tc('cancel'),
    });
    if (!name) return;
    const res = await window.fireeyeaud?.renamePath({ root, path: entry.path, newName: name });
    if (res?.ok) onRefresh();
    else fail(res?.code);
  };

  const doDelete = async (entry: FsEntry) => {
    const confirmed = await confirm({
      title: t('delete'),
      message: t('deleteConfirm', { name: entry.name }),
      confirmLabel: t('delete'),
      cancelLabel: tc('cancel'),
      danger: true,
    });
    if (!confirmed) return;
    const res = await window.fireeyeaud?.deletePath({ root, path: entry.path });
    if (res?.ok) onDeleted(entry.path);
    else fail(res?.code);
  };

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    const current = menu;
    if (!current) return [];
    const { entry, isRoot } = current;
    const items: ContextMenuItem[] = [];
    const parent = entry ? (entry.isDir ? entry.path : parentDir(entry.path)) : selectedDir || root;
    items.push({
      key: 'newFolder',
      label: t('newFolder'),
      onSelect: () => void createFolder(parent),
    });
    items.push({
      key: 'newFile',
      label: t('newFile'),
      onSelect: () => void createFile(parent),
    });
    items.push({ key: 'upload', label: t('upload'), onSelect: onUpload });
    if (entry) {
      items.push({
        key: 'reveal',
        label: t('showInFolder'),
        onSelect: () => void window.fireeyeaud?.showItemInFolder(entry.path),
      });
    }
    if (!isRoot && entry) {
      items.push({
        key: 'rename',
        label: t('rename'),
        onSelect: () => void doRename(entry),
      });
      if (!entry.isDir && isTableFile(entry.name)) {
        items.push({
          key: 'import',
          label: t('importData'),
          onSelect: () => onImportData(entry.path),
        });
      }
      if (!entry.isDir && dbDriverFor(entry.name)) {
        items.push({
          key: 'openDb',
          label: t('openDbAuth'),
          onSelect: () => onOpenDatabase(entry.path, entry.name),
        });
      }
      items.push({
        key: 'delete',
        label: t('delete'),
        danger: true,
        onSelect: () => void doDelete(entry),
      });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, selectedDir, root, t]);

  const rootEntry: FsEntry = { name: baseName(root), path: root, isDir: true };

  return (
    <div
      className="tree"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, entry: null, isRoot: true, protectedPath: false });
      }}
      onDragOver={(event) => {
        const types = event.dataTransfer.types;
        if (types.includes(DRAG_TYPE) || types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        const types = event.dataTransfer.types;
        if (!types.includes(DRAG_TYPE) && !types.includes('Files')) return;
        event.preventDefault();
        void dropOn(selectedDir || root, event);
      }}
    >
      <TreeNode entry={rootEntry} depth={0} isRoot protectedPath={false} api={api} />
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
