import type { Editor } from '@tiptap/react';
import type { LucideIcon } from 'lucide-react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Columns2,
  Columns3,
  Italic,
  List,
  Redo2,
  Rows2,
  Rows3,
  Table2,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

function ToolButton({
  editor,
  label,
  icon: Icon,
  active,
  disabled,
  danger,
  onClick,
}: {
  editor: Editor | null;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick: (editor: Editor) => void;
}) {
  return (
    <button
      type="button"
      className={`icon-btn report-editor-toolbar__btn${active ? ' is-active' : ''}${
        danger ? ' report-editor-toolbar__btn--danger' : ''
      }`}
      title={label}
      aria-label={label}
      disabled={!editor || disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (editor) onClick(editor);
      }}
    >
      <Icon size={13} strokeWidth={1.9} />
    </button>
  );
}

export function ReportEditorToolbar({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation('report');
  const inTable = Boolean(editor?.isActive('table'));

  return (
    <div className="report-editor-toolbar">
      <ToolButton
        editor={editor}
        label={t('editorBold')}
        icon={Bold}
        active={editor?.isActive('bold')}
        onClick={(instance) => instance.chain().focus().toggleBold().run()}
      />
      <ToolButton
        editor={editor}
        label={t('editorItalic')}
        icon={Italic}
        active={editor?.isActive('italic')}
        onClick={(instance) => instance.chain().focus().toggleItalic().run()}
      />
      <ToolButton
        editor={editor}
        label={t('editorUnderline')}
        icon={Underline}
        active={editor?.isActive('underline')}
        onClick={(instance) => instance.chain().focus().toggleUnderline().run()}
      />
      <span className="report-editor-toolbar__sep" />
      <ToolButton
        editor={editor}
        label={t('editorAlignLeft')}
        icon={AlignLeft}
        active={editor?.isActive({ textAlign: 'left' })}
        onClick={(instance) => instance.chain().focus().setTextAlign('left').run()}
      />
      <ToolButton
        editor={editor}
        label={t('editorAlignCenter')}
        icon={AlignCenter}
        active={editor?.isActive({ textAlign: 'center' })}
        onClick={(instance) => instance.chain().focus().setTextAlign('center').run()}
      />
      <ToolButton
        editor={editor}
        label={t('editorAlignRight')}
        icon={AlignRight}
        active={editor?.isActive({ textAlign: 'right' })}
        onClick={(instance) => instance.chain().focus().setTextAlign('right').run()}
      />
      <ToolButton
        editor={editor}
        label={t('editorAlignJustify')}
        icon={AlignJustify}
        active={editor?.isActive({ textAlign: 'justify' })}
        onClick={(instance) => instance.chain().focus().setTextAlign('justify').run()}
      />
      <span className="report-editor-toolbar__sep" />
      <ToolButton
        editor={editor}
        label={t('editorBulletList')}
        icon={List}
        active={editor?.isActive('bulletList')}
        onClick={(instance) => instance.chain().focus().toggleBulletList().run()}
      />
      <ToolButton
        editor={editor}
        label={t('editorInsertTable')}
        icon={Table2}
        onClick={(instance) =>
          instance.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
        }
      />
      <ToolButton
        editor={editor}
        label={t('editorAddRow')}
        icon={Rows3}
        disabled={!inTable}
        onClick={(instance) => instance.chain().focus().addRowAfter().run()}
      />
      <ToolButton
        editor={editor}
        label={t('editorDeleteRow')}
        icon={Rows2}
        danger
        disabled={!inTable}
        onClick={(instance) => instance.chain().focus().deleteRow().run()}
      />
      <ToolButton
        editor={editor}
        label={t('editorAddColumn')}
        icon={Columns3}
        disabled={!inTable}
        onClick={(instance) => instance.chain().focus().addColumnAfter().run()}
      />
      <ToolButton
        editor={editor}
        label={t('editorDeleteColumn')}
        icon={Columns2}
        danger
        disabled={!inTable}
        onClick={(instance) => instance.chain().focus().deleteColumn().run()}
      />
      <ToolButton
        editor={editor}
        label={t('editorDeleteTable')}
        icon={Trash2}
        danger
        disabled={!inTable}
        onClick={(instance) => instance.chain().focus().deleteTable().run()}
      />
      <span className="report-editor-toolbar__sep" />
      <ToolButton
        editor={editor}
        label={t('editorUndo')}
        icon={Undo2}
        onClick={(instance) => instance.chain().focus().undo().run()}
      />
      <ToolButton
        editor={editor}
        label={t('editorRedo')}
        icon={Redo2}
        onClick={(instance) => instance.chain().focus().redo().run()}
      />
    </div>
  );
}
