import { useEffect, useRef } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { textLanguage } from './util';

function languageExt(name: string): Extension | null {
  switch (textLanguage(name)) {
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'json':
      return json();
    case 'markdown':
      return markdown();
    case 'python':
      return python();
    case 'html':
      return html();
    case 'css':
      return css();
    case 'sql':
      return sql();
    case 'xml':
      return xml();
    case 'yaml':
      return yaml();
    default:
      return null;
  }
}

interface TextPreviewProps {
  /** 仅作初始文档；同一编辑器实例不再响应外部变更。 */
  initialValue: string;
  name: string;
  readOnly: boolean;
  dark: boolean;
  /** 目标行（1 基）；来自搜索结果点击，打开后滚动定位并高亮。 */
  line?: number;
  /** 目标列（1 基）；越界钳制到行内。 */
  column?: number;
  onChange: (value: string) => void;
  onSave: () => void;
}

/** 设置/清除目标行高亮的 effect。 */
const setTargetLine = StateEffect.define<number | null>();

/** 目标行高亮装饰（`.cm-targetLine`），随文档变更映射。 */
const targetLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setTargetLine)) continue;
      if (effect.value == null) {
        next = Decoration.none;
      } else {
        const lineNo = Math.min(Math.max(effect.value, 1), tr.state.doc.lines);
        const target = tr.state.doc.line(lineNo);
        next = Decoration.set([
          Decoration.line({ class: 'cm-targetLine' }).range(target.from),
        ]);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** CodeMirror 6 文本编辑器：行号 + 语法高亮；readOnly 时只读展示。 */
export function TextPreview({
  initialValue,
  name,
  readOnly,
  dark,
  line,
  column,
  onChange,
  onSave,
}: TextPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const lang = languageExt(name);
    const view = new EditorView({
      doc: initialValue,
      parent: host,
      extensions: [
        basicSetup,
        targetLineField,
        EditorView.theme(
          {
            '&': {
              height: '100%',
              fontSize: '12px',
              backgroundColor: 'var(--editor-bg)',
              color: 'var(--text-1)',
            },
            '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.5' },
            '.cm-gutters': {
              backgroundColor: 'var(--editor-bg)',
              color: 'var(--text-3)',
              border: 'none',
            },
            '.cm-activeLine': { backgroundColor: 'var(--hover)' },
            '.cm-activeLineGutter': { backgroundColor: 'var(--hover)' },
            '.cm-content': { caretColor: 'var(--accent)' },
          },
          { dark },
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          keydown: (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              onSaveRef.current();
              return true;
            }
            return false;
          },
        }),
        ...(readOnly ? [EditorView.editable.of(false)] : []),
        ...(lang ? [lang] : []),
      ],
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 每个文件一个实例（父组件以 key=path 重挂载）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 定位到目标行：滚动居中 + 光标落到命中列 + 高亮该行。
  // 同一文件再次点击其它命中行时（line/column 变化）重复触发。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (line == null) {
      view.dispatch({ effects: setTargetLine.of(null) });
      return;
    }
    const lineNo = Math.min(Math.max(line, 1), view.state.doc.lines);
    const info = view.state.doc.line(lineNo);
    const col = column == null ? 1 : Math.min(Math.max(column, 1), info.length + 1);
    const pos = info.from + col - 1;
    view.dispatch({
      selection: { anchor: pos },
      effects: [EditorView.scrollIntoView(pos, { y: 'center' }), setTargetLine.of(lineNo)],
    });
    view.focus();
  }, [line, column]);

  return <div className="textpreview" ref={hostRef} />;
}
