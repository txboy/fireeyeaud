import { useEffect } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Input } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ReportSection } from '@fireeyeaud/shared';
import { reportEditorExtensions } from './editor/reportEditorExtensions';
import { sectionToTiptap } from './editor/reportEditorModel';

/** 单个章节的富文本编辑器；章节标题单独编辑，正文按块保存。 */
export function ReportSectionEditor({
  section,
  title,
  onTitleChange,
  onReady,
  onFocus,
  onDirty,
}: {
  section: ReportSection;
  title: string;
  onTitleChange: (title: string) => void;
  onReady: (sectionId: string, editor: Editor | null) => void;
  onFocus: (editor: Editor) => void;
  onDirty: () => void;
}) {
  const { t } = useTranslation('report');
  const editor = useEditor(
    {
      extensions: reportEditorExtensions(),
      content: sectionToTiptap(section),
      editable: true,
      editorProps: {
        attributes: {
          class: 'report-editor__content',
          spellcheck: 'false',
        },
      },
      onFocus: ({ editor: instance }) => onFocus(instance),
      onUpdate: () => onDirty(),
    },
    [section.id],
  );

  useEffect(() => {
    if (!editor) return;
    onReady(section.id, editor);
    return () => onReady(section.id, null);
  }, [editor, onReady, section.id]);

  const refs = [...new Set(section.blocks.flatMap((block) => block.sourceRefs ?? []))];

  return (
    <article className="report-section report-editor-section">
      <div className="report-editor-section__head">
        <Input
          className="report-editor-section__title"
          value={title}
          placeholder={t('sectionTitlePlaceholder')}
          onChange={(event) => onTitleChange(event.target.value)}
        />
        {refs.length > 0 && (
          <span className="report-editor-section__refs" title={t('source')}>
            {refs.map((ref) => (
              <span key={ref} className="report-ref">
                {ref}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="report-editor">
        <EditorContent editor={editor} />
      </div>
    </article>
  );
}
