import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  Plus,
  X,
} from 'lucide-react';
import type { FsEntry } from '@fireeyeaud/shared';

/**
 * 搜索范围选择器：从工作区懒加载树里勾选文件夹（整棵子树）或文件，
 * 结果以 chips 展示。token 约定：目录以 `/` 结尾，文件为精确相对路径。
 */
interface SearchScopePickerProps {
  root: string | null;
  value: string[];
  onChange: (next: string[]) => void;
}

interface ScopeNodeProps {
  root: string;
  entry: FsEntry;
  rel: string;
  depth: number;
  selected: Set<string>;
  onToggle: (token: string) => void;
}

/** 内部目录：搜索会整棵跳过，选择器也不展示、不可选。 */
const PROTECTED_DIR = '.fireeye';

function selectableEntries(entries: FsEntry[]): FsEntry[] {
  return entries.filter((entry) => entry.name !== PROTECTED_DIR);
}

/** 单个可勾选节点：目录可展开（懒加载），复选框=加入/移除范围。 */
function ScopeNode({ root, entry, rel, depth, selected, onToggle }: ScopeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fireeyeaud?.readDir({ root, dir: entry.path });
      setChildren(selectableEntries(res?.entries ?? []));
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [root, entry.path]);

  const token = entry.isDir ? `${rel}/` : rel;
  const checked = selected.has(token);

  const toggleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) await load();
  };

  return (
    <>
      <div className="scope__row" style={{ paddingLeft: 4 + depth * 14 }}>
        {entry.isDir ? (
          <button
            type="button"
            className="scope__chevron"
            onClick={() => void toggleExpand()}
            aria-label={entry.name}
          >
            {expanded ? (
              <ChevronDown size={12} strokeWidth={2} />
            ) : (
              <ChevronRight size={12} strokeWidth={2} />
            )}
          </button>
        ) : (
          <span className="scope__chevron" />
        )}
        <input
          type="checkbox"
          className="scope__check"
          checked={checked}
          onChange={() => onToggle(token)}
          aria-label={rel}
        />
        {entry.isDir ? (
          expanded ? (
            <FolderOpen size={13} strokeWidth={1.75} />
          ) : (
            <Folder size={13} strokeWidth={1.75} />
          )
        ) : (
          <FileIcon size={13} strokeWidth={1.75} />
        )}
        <span
          className="scope__name"
          title={rel}
          onClick={() => onToggle(token)}
        >
          {entry.name}
        </span>
      </div>
      {expanded && (
        <>
          {loading && (
            <div
              className="scope__row scope__row--muted"
              style={{ paddingLeft: 4 + (depth + 1) * 14 + 13 }}
            >
              …
            </div>
          )}
          {children?.map((child) => (
            <ScopeNode
              key={child.path}
              root={root}
              entry={child}
              rel={rel ? `${rel}/${child.name}` : child.name}
              depth={depth + 1}
              selected={selected}
              onToggle={onToggle}
            />
          ))}
        </>
      )}
    </>
  );
}

/** 工作区根的直接子项（根本身不可选——空范围即整库）。 */
function ScopeTree({
  root,
  selected,
  onToggle,
}: {
  root: string;
  selected: Set<string>;
  onToggle: (token: string) => void;
}) {
  const { t } = useTranslation('search');
  const [children, setChildren] = useState<FsEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await window.fireeyeaud?.readDir({ root, dir: root });
      if (alive) setChildren(selectableEntries(res?.entries ?? []));
    })();
    return () => {
      alive = false;
    };
  }, [root]);

  if (children === null) {
    return <div className="scope__row scope__row--muted">…</div>;
  }
  if (children.length === 0) {
    return (
      <div className="scope__row scope__row--muted">{t('scopeEmpty')}</div>
    );
  }
  return (
    <>
      {children.map((child) => (
        <ScopeNode
          key={child.path}
          root={root}
          entry={child}
          rel={child.name}
          depth={0}
          selected={selected}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

export function SearchScopePicker({ root, value, onChange }: SearchScopePickerProps) {
  const { t } = useTranslation('search');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const selected = useMemo(() => new Set(value), [value]);

  const toggle = useCallback(
    (token: string) => {
      onChange(
        selected.has(token) ? value.filter((item) => item !== token) : [...value, token],
      );
    },
    [selected, value, onChange],
  );

  const remove = (token: string) => onChange(value.filter((item) => item !== token));

  return (
    <div className="scope" ref={wrapRef}>
      <div className="scope__chips">
        {value.map((token) => (
          <span key={token} className="scope__chip" title={token}>
            <span className="scope__chip-label">
              {token.endsWith('/') ? token.slice(0, -1) : token}
            </span>
            <button
              type="button"
              className="scope__chip-x"
              onClick={() => remove(token)}
              aria-label={t('removeScope')}
            >
              <X size={11} strokeWidth={2} />
            </button>
          </span>
        ))}
        <button
          type="button"
          className="scope__add"
          onClick={() => setOpen((prev) => !prev)}
          disabled={!root}
        >
          <Plus size={12} strokeWidth={2} />
          {t('addScope')}
        </button>
        {value.length > 0 && (
          <button type="button" className="scope__clear" onClick={() => onChange([])}>
            {t('clearScope')}
          </button>
        )}
      </div>
      {open && root && (
        <div className="scope__pop">
          <ScopeTree root={root} selected={selected} onToggle={toggle} />
        </div>
      )}
    </div>
  );
}
