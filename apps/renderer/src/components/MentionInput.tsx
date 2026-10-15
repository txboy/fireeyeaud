import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ArrowUp, CornerDownLeft, FileText, Folder } from 'lucide-react';
import type { FsEntry } from '@fireeyeaud/shared';
import type { AttachmentRef, WorkspaceRef } from '../lib/api';
import { WORKSPACE_DRAG_ENTRY, WORKSPACE_DRAG_PATH } from '../lib/dnd';
import type { DraftSegment } from '../store/chat';
import { useWorkspaceStore } from '../store/workspace';

export interface MentionInputHandle {
  /** 在末尾插入一个临时附件 @ 标记（供「附加文件」按钮调用）。 */
  insertAttachment: (ref: AttachmentRef) => void;
  focus: () => void;
}

interface Props {
  initialSegments: DraftSegment[];
  placeholder: string;
  disabled?: boolean;
  onChange: (segments: DraftSegment[]) => void;
  onSubmit: () => void;
}

type PopRow =
  | { kind: 'up' }
  | { kind: 'self'; name: string }
  | { kind: 'dir'; name: string; entry: FsEntry }
  | { kind: 'file'; name: string; entry: FsEntry };

interface Anchor {
  node: Text;
  at: number;
}

/** @ 选择器里不展示的目录名（内部/噪音）。 */
const HIDDEN_DIRS = new Set(['.fireeye', '.git', 'node_modules']);
/** @ 选择器里不展示的文件名。 */
const HIDDEN_FILES = new Set(['.DS_Store', 'Thumbs.db']);
/** @ 选择器里不展示的文件后缀（内部数据/日志/锁文件/Access 库文件）。 */
const HIDDEN_EXTS = [
  '.sqlite',
  '.sqlite3',
  '.db',
  '.log',
  '.lock',
  '.mdb',
  '.mde',
  '.accdb',
  '.accde',
  '.accdr',
  '.accdt',
  '.ldb',
  '.laccdb',
];

function isHiddenEntry(entry: FsEntry): boolean {
  if (HIDDEN_DIRS.has(entry.name) || HIDDEN_FILES.has(entry.name)) return true;
  const lower = entry.name.toLowerCase();
  return HIDDEN_EXTS.some((ext) => lower.endsWith(ext));
}

function baseName(abs: string): string {
  const idx = Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\'));
  return idx >= 0 ? abs.slice(idx + 1) : abs;
}

function parentDir(abs: string): string {
  const idx = Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\'));
  return idx > 0 ? abs.slice(0, idx) : abs;
}

function rowKey(row: PopRow): string {
  if (row.kind === 'up') return 'up';
  if (row.kind === 'self') return `self:${row.name}`;
  return `${row.kind}:${row.entry.path}`;
}

function rowLabel(row: PopRow): string {
  return row.kind === 'up' ? '..' : row.name;
}

/** 绝对路径 → 工作区相对 POSIX 路径。 */
function toRel(root: string, abs: string): string {
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const a = abs.replace(/\\/g, '/').replace(/\/+$/, '');
  if (a === r) return '';
  if (a.toLowerCase().startsWith(`${r.toLowerCase()}/`)) return a.slice(r.length + 1);
  return a;
}

/** 判断绝对路径是否位于工作区内（Windows 盘符大小写不敏感）。 */
function isInside(root: string, abs: string): boolean {
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const a = abs.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return a === r || a.startsWith(`${r}/`);
}

function tokenEl(seg: Extract<DraftSegment, { type: 'mention' | 'attach' }>): HTMLSpanElement {
  const span = document.createElement('span');
  span.contentEditable = 'false';
  span.className =
    seg.type === 'mention' ? 'mention-token' : 'mention-token mention-token--attach';
  span.dataset.mention = seg.type === 'mention' ? 'workspace' : 'attach';
  span.dataset.path = seg.ref.path;
  span.dataset.name = seg.ref.name;
  if (seg.type === 'mention') span.dataset.isdir = seg.ref.isDir ? '1' : '0';
  span.title = seg.ref.path;
  span.textContent = `@${seg.ref.name}`;
  return span;
}

function appendToken(container: HTMLElement, seg: Extract<DraftSegment, { type: 'mention' | 'attach' }>): void {
  container.appendChild(tokenEl(seg));
  container.appendChild(document.createTextNode('\u00A0'));
}

function renderSegments(container: HTMLElement, segments: DraftSegment[]): void {
  container.textContent = '';
  for (const seg of segments) {
    if (seg.type === 'text') {
      if (seg.text) container.appendChild(document.createTextNode(seg.text));
    } else {
      appendToken(container, seg);
    }
  }
}

function serialize(node: Node): DraftSegment[] {
  const out: DraftSegment[] = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out.push({ type: 'text', text: child.textContent ?? '' });
      return;
    }
    if (!(child instanceof HTMLElement)) return;
    const kind = child.dataset.mention;
    if (kind === 'workspace') {
      const ref: WorkspaceRef = {
        path: child.dataset.path ?? '',
        name: child.dataset.name ?? '',
        isDir: child.dataset.isdir === '1',
      };
      out.push({ type: 'mention', ref });
    } else if (kind === 'attach') {
      out.push({
        type: 'attach',
        ref: { path: child.dataset.path ?? '', name: child.dataset.name ?? '' },
      });
    } else if (child.tagName === 'BR') {
      out.push({ type: 'text', text: '\n' });
    } else {
      out.push(...serialize(child));
    }
  });
  return out;
}

/** 检测光标前的 `@关键词`（无空白），返回所在文本节点与 `@` 偏移。 */
function detectTrigger(): { node: Text; at: number; query: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return null;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? '';
  const before = text.slice(0, range.startOffset);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { node: node as Text, at, query };
}

export const MentionInput = forwardRef<MentionInputHandle, Props>(function MentionInput(
  { initialSegments, placeholder, disabled, onChange, onSubmit },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const root = useWorkspaceStore((s) => s.path);

  const [pop, setPop] = useState<{
    open: boolean;
    query: string;
    dir: string;
    entries: FsEntry[];
    index: number;
  }>({ open: false, query: '', dir: '', entries: [], index: 0 });

  const [dragging, setDragging] = useState(false);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (el) onChange(serialize(el));
  }, [onChange]);

  useEffect(() => {
    const el = editorRef.current;
    if (el) renderSegments(el, initialSegments);
    // 仅在挂载时从草稿初始化一次；之后由用户输入驱动（受控会造成光标跳动）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDir = useCallback(
    async (dir: string) => {
      if (!root) return;
      try {
        const res = await window.fireeyeaud?.readDir({ root, dir });
        setPop((p) => ({ ...p, dir, entries: res?.entries ?? [], index: 0 }));
      } catch {
        setPop((p) => ({ ...p, dir, entries: [], index: 0 }));
      }
    },
    [root],
  );

  /** 删除 `@` 之后的查询文本（保留 `@`），用于目录下钻后重置过滤。 */
  const clearQueryText = useCallback(() => {
    const anchor = anchorRef.current;
    const sel = window.getSelection();
    if (!anchor || !anchor.node.isConnected || !sel) return;
    const caret = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const end =
      caret && caret.startContainer === anchor.node
        ? caret.startOffset
        : anchor.node.length;
    const start = Math.min(anchor.at + 1, anchor.node.length);
    const range = document.createRange();
    range.setStart(anchor.node, start);
    range.setEnd(anchor.node, Math.max(end, start));
    range.deleteContents();
    const after = document.createRange();
    after.setStart(anchor.node, start);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  }, []);

  const rows = useMemo<PopRow[]>(() => {
    if (!pop.open || !root) return [];
    const q = pop.query.toLowerCase();
    const dirs: FsEntry[] = [];
    const files: FsEntry[] = [];
    for (const entry of pop.entries) {
      if (isHiddenEntry(entry)) continue;
      if (q && !entry.name.toLowerCase().includes(q)) continue;
      (entry.isDir ? dirs : files).push(entry);
    }
    const out: PopRow[] = [];
    if (pop.dir && parentDir(pop.dir) !== pop.dir && toRel(root, pop.dir) !== '') {
      out.push({ kind: 'up' });
      out.push({ kind: 'self', name: baseName(pop.dir) });
    }
    for (const entry of [...dirs, ...files]) {
      out.push({
        kind: entry.isDir ? 'dir' : 'file',
        name: entry.name,
        entry,
      });
    }
    return out;
  }, [pop, root]);

  const insertMention = useCallback(
    (seg: Extract<DraftSegment, { type: 'mention' | 'attach' }>) => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      const anchor = anchorRef.current;
      const sel = window.getSelection();
      if (anchor && anchor.node.isConnected && sel) {
        const caret = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
        const end =
          caret && caret.startContainer === anchor.node
            ? caret.startOffset
            : anchor.node.length;
        const start = Math.min(anchor.at, anchor.node.length);
        const range = document.createRange();
        range.setStart(anchor.node, start);
        range.setEnd(anchor.node, Math.max(end, start));
        range.deleteContents();
        const space = document.createTextNode('\u00A0');
        range.insertNode(space);
        space.before(tokenEl(seg));
        const after = document.createRange();
        after.setStart(space, space.length);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
      } else {
        appendToken(el, seg);
      }
      anchorRef.current = null;
      setPop((p) => ({ ...p, open: false }));
      emit();
    },
    [emit],
  );

  const choose = useCallback(
    (row: PopRow) => {
      if (row.kind === 'up') {
        clearQueryText();
        void loadDir(parentDir(pop.dir));
        setPop((p) => ({ ...p, query: '' }));
        return;
      }
      if (!root) return;
      if (row.kind === 'self') {
        insertMention({
          type: 'mention',
          ref: { path: toRel(root, pop.dir), name: row.name, isDir: true },
        });
        return;
      }
      if (row.kind === 'dir') {
        clearQueryText();
        void loadDir(row.entry.path);
        setPop((p) => ({ ...p, query: '' }));
        return;
      }
      insertMention({
        type: 'mention',
        ref: {
          path: toRel(root, row.entry.path),
          name: row.name,
          isDir: false,
        },
      });
    },
    [pop.dir, root, loadDir, insertMention, clearQueryText],
  );

  const appendSegments = useCallback(
    (segs: DraftSegment[]) => {
      const el = editorRef.current;
      if (!el || segs.length === 0) return;
      el.focus();
      for (const seg of segs) {
        if (seg.type === 'text') el.appendChild(document.createTextNode(seg.text));
        else appendToken(el, seg);
      }
      emit();
    },
    [emit],
  );

  /** 拖入项 → 草稿分段：工作区内为 @ 引用；工作区外文件为临时附件。 */
  const entryToSegment = useCallback(
    (abs: string, name: string, isDir: boolean): DraftSegment | null => {
      const label = name || baseName(abs);
      if (root && isInside(root, abs)) {
        const rel = toRel(root, abs);
        if (!rel) return null; // 工作区根自身不作为引用
        return { type: 'mention', ref: { path: rel, name: label, isDir } };
      }
      if (isDir) return null; // 工作区外目录无法作为附件
      return { type: 'attach', ref: { path: abs, name: label } };
    },
    [root],
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const types = event.dataTransfer.types;
    if (
      !types.includes(WORKSPACE_DRAG_PATH) &&
      !types.includes(WORKSPACE_DRAG_ENTRY) &&
      !types.includes('Files')
    ) {
      return;
    }
    event.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragging(false), []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const types = event.dataTransfer.types;
      if (
        !types.includes(WORKSPACE_DRAG_PATH) &&
        !types.includes(WORKSPACE_DRAG_ENTRY) &&
        !types.includes('Files')
      ) {
        return;
      }
      event.preventDefault();
      setDragging(false);
      const dt = event.dataTransfer;
      const segs: DraftSegment[] = [];

      // 1) 工作区文件树内部拖拽（带元数据，优先）。
      const entryJson = dt.getData(WORKSPACE_DRAG_ENTRY);
      if (entryJson) {
        try {
          const meta = JSON.parse(entryJson) as {
            path?: string;
            name?: string;
            isDir?: boolean;
          };
          if (meta.path) {
            const seg = entryToSegment(meta.path, meta.name ?? '', Boolean(meta.isDir));
            if (seg) segs.push(seg);
          }
        } catch {
          /* 忽略非法元数据 */
        }
      } else {
        const internalPath = dt.getData(WORKSPACE_DRAG_PATH);
        if (internalPath) {
          const seg = entryToSegment(internalPath, baseName(internalPath), false);
          if (seg) segs.push(seg);
        }
      }

      // 2) 外部文件（桌面 / 资源管理器）。items 必须在事件内同步读取。
      if (segs.length === 0) {
        for (const item of Array.from(dt.items ?? [])) {
          if (item.kind !== 'file') continue;
          const entry = item.webkitGetAsEntry?.();
          const file = item.getAsFile();
          if (!file) continue;
          const abs = window.fireeyeaud?.getPathForFile(file);
          if (!abs) continue;
          const seg = entryToSegment(abs, file.name, Boolean(entry?.isDirectory));
          if (seg) segs.push(seg);
        }
      }

      appendSegments(segs);
    },
    [appendSegments, entryToSegment],
  );

  useImperativeHandle(
    ref,
    () => ({
      insertAttachment: (ref0: AttachmentRef) =>
        appendSegments([{ type: 'attach', ref: ref0 }]),
      focus: () => editorRef.current?.focus(),
    }),
    [appendSegments],
  );

  const handleInput = useCallback(() => {
    emit();
    const trig = detectTrigger();
    if (!trig) {
      anchorRef.current = null;
      setPop((p) => (p.open ? { ...p, open: false } : p));
      return;
    }
    anchorRef.current = { node: trig.node, at: trig.at };
    if (pop.open) {
      setPop((p) => ({ ...p, open: true, query: trig.query }));
    } else {
      setPop((p) => ({ ...p, open: true, query: trig.query, dir: root ?? '', index: 0 }));
      if (root) void loadDir(root);
    }
  }, [emit, root, loadDir, pop.open]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (pop.open) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setPop((p) => ({
            ...p,
            index: Math.max(0, Math.min(p.index + 1, rows.length - 1)),
          }));
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setPop((p) => ({ ...p, index: Math.max(p.index - 1, 0) }));
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          const row = rows[Math.min(pop.index, rows.length - 1)];
          if (row) choose(row);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setPop((p) => ({ ...p, open: false }));
          return;
        }
      }
      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
        event.preventDefault();
        onSubmit();
      }
    },
    [pop.open, pop.index, rows, choose, onSubmit],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      const text = event.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
      emit();
    },
    [emit],
  );

  return (
    <div className="mention-field">
      {pop.open && rows.length > 0 && (
        <div className="mention-pop" role="listbox">
          <div className="mention-pop__hint">{pop.dir ? toRel(root ?? '', pop.dir) || '.' : '.'}</div>
          {rows.map((row, i) => (
            <button
              key={rowKey(row)}
              type="button"
              role="option"
              aria-selected={i === pop.index}
              className={`mention-pop__row${i === pop.index ? ' is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(row);
              }}
            >
              {row.kind === 'up' ? (
                <ArrowUp size={13} strokeWidth={1.75} />
              ) : row.kind === 'dir' || row.kind === 'self' ? (
                <Folder size={13} strokeWidth={1.75} />
              ) : (
                <FileText size={13} strokeWidth={1.75} />
              )}
              <span className="mention-pop__name">{rowLabel(row)}</span>
              {row.kind === 'self' && (
                <span className="mention-pop__tag">
                  <CornerDownLeft size={11} strokeWidth={1.75} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div
        ref={editorRef}
        className={`mention-editor${dragging ? ' is-drop-target' : ''}`}
        role="textbox"
        aria-multiline="false"
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onBlur={() => setPop((p) => (p.open ? { ...p, open: false } : p))}
      />
    </div>
  );
});
