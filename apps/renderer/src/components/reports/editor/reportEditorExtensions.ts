import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import BulletList from '@tiptap/extension-bullet-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';

function metadataAttributes() {
  return {
    sourceRefs: {
      default: [],
      parseHTML: (element: HTMLElement) => {
        const raw = element.getAttribute('data-source-refs');
        if (!raw) return [];
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          return [];
        }
      },
      renderHTML: (attributes: Record<string, unknown>) => {
        const refs = attributes.sourceRefs;
        return Array.isArray(refs) && refs.length > 0
          ? { 'data-source-refs': JSON.stringify(refs) }
          : {};
      },
    },
    origin: {
      default: 'user',
      parseHTML: (element: HTMLElement) => element.getAttribute('data-origin') || 'user',
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes.origin ? { 'data-origin': String(attributes.origin) } : {},
    },
  };
}

/** 段落保留来源与提供方，避免手工编辑后丢失审计元数据。 */
const ReportParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...metadataAttributes(),
    };
  },
});

const ReportBulletList = BulletList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...metadataAttributes(),
    };
  },
});

const ReportTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...metadataAttributes(),
    };
  },
});

export function reportEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      paragraph: false,
      bulletList: false,
      heading: false,
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      link: false,
      orderedList: false,
      strike: false,
    }),
    ReportParagraph,
    ReportBulletList,
    ReportTable,
    TableRow,
    TableHeader,
    TableCell,
    TextAlign.configure({ types: ['paragraph'] }),
  ];
}
