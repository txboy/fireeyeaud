import { useEffect, useRef } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import type { Extension } from '@codemirror/state';
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
  onChange: (value: string) => void;
  onSave: () => void;
}

/** CodeMirror 6 文本编辑器：行号 + 语法高亮；readOnly 时只读展示。 */
export function TextPreview({
  initialValue,
  name,
  readOnly,
  dark,
  onChange,
  onSave,
}: TextPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
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
    return () => view.destroy();
    // 每个文件一个实例（父组件以 key=path 重挂载）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="textpreview" ref={hostRef} />;
}
