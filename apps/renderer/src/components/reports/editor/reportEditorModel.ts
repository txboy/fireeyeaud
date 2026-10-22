import type { JSONContent } from '@tiptap/core';
import type {
  ReportBlock,
  ReportBlockOrigin,
  ReportSection,
  ReportTextAlign,
  ReportTextRun,
} from '@fireeyeaud/shared';

function normalizeRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item)).filter(Boolean))];
}

function normalizeOrigin(value: unknown): ReportBlockOrigin {
  return value === 'form' || value === 'user' || value === 'model' ? value : 'form';
}

function normalizeAlign(value: unknown): ReportTextAlign | undefined {
  return value === 'left' || value === 'center' || value === 'right' || value === 'justify'
    ? value
    : undefined;
}

function marksOf(run: ReportTextRun): JSONContent['marks'] {
  const marks: NonNullable<JSONContent['marks']> = [];
  if (run.bold) marks.push({ type: 'bold' });
  if (run.italic) marks.push({ type: 'italic' });
  if (run.underline) marks.push({ type: 'underline' });
  return marks.length > 0 ? marks : undefined;
}

function runsToContent(text: string, runs?: ReportTextRun[]): JSONContent[] {
  const source = runs && runs.length > 0 ? runs : [{ text }];
  const content: JSONContent[] = [];
  for (const run of source) {
    if (!run.text) continue;
    const parts = run.text.split('\n');
    parts.forEach((part, index) => {
      if (part) {
        content.push({ type: 'text', text: part, marks: marksOf(run) });
      }
      if (index < parts.length - 1) content.push({ type: 'hardBreak' });
    });
  }
  return content;
}

interface InlineResult {
  text: string;
  runs?: ReportTextRun[];
  align?: ReportTextAlign;
}

function pushRun(runs: ReportTextRun[], text: string, marks: ReportTextRun): void {
  if (!text) return;
  const previous = runs[runs.length - 1];
  if (
    previous &&
    Boolean(previous.bold) === Boolean(marks.bold) &&
    Boolean(previous.italic) === Boolean(marks.italic) &&
    Boolean(previous.underline) === Boolean(marks.underline)
  ) {
    previous.text += text;
    return;
  }
  const run: ReportTextRun = { text };
  if (marks.bold) run.bold = true;
  if (marks.italic) run.italic = true;
  if (marks.underline) run.underline = true;
  runs.push(run);
}

function inlineFromContent(content: JSONContent[] | undefined): InlineResult {
  const runs: ReportTextRun[] = [];
  const walk = (nodes: JSONContent[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === 'text') {
        const text = node.text ?? '';
        const marks = {
          bold: Boolean(node.marks?.some((mark) => mark.type === 'bold')),
          italic: Boolean(node.marks?.some((mark) => mark.type === 'italic')),
          underline: Boolean(node.marks?.some((mark) => mark.type === 'underline')),
        };
        pushRun(runs, text, { ...marks, text: '' });
      } else if (node.type === 'hardBreak') {
        const previous = runs[runs.length - 1];
        if (previous) previous.text += '\n';
        else runs.push({ text: '\n' });
      } else if (node.content) {
        walk(node.content);
      }
    }
  };
  walk(content);
  const text = runs.map((run) => run.text).join('');
  const hasMarks = runs.some((run) => run.bold || run.italic || run.underline);
  return hasMarks ? { text, runs } : { text };
}

function inlineFromBlocks(content: JSONContent[] | undefined): InlineResult {
  const paragraphs = (content ?? []).filter((node) => node.type === 'paragraph');
  if (paragraphs.length === 0) return { text: '' };
  const results = paragraphs.map((node) => inlineFromContent(node.content));
  const text = results.map((item) => item.text).join('\n');
  const runs: ReportTextRun[] = [];
  results.forEach((item, index) => {
    if (item.runs) {
      for (const run of item.runs) pushRun(runs, run.text, run);
    } else if (item.text) {
      pushRun(runs, item.text, { text: '' });
    }
    if (index < results.length - 1) pushRun(runs, '\n', { text: '' });
  });
  const align = normalizeAlign(paragraphs[0]?.attrs?.textAlign);
  const hasMarks = runs.some((run) => run.bold || run.italic || run.underline);
  if (hasMarks) return { text, runs, ...(align ? { align } : {}) };
  return { text, ...(align ? { align } : {}) };
}

function paragraphNode(
  text: string,
  runs?: ReportTextRun[],
  attrs?: JSONContent['attrs'],
): JSONContent {
  return {
    type: 'paragraph',
    ...(attrs ? { attrs } : {}),
    content: runsToContent(text, runs),
  };
}

function tableCellNode(
  type: 'tableCell' | 'tableHeader',
  text: string,
  runs?: ReportTextRun[],
  align?: ReportTextAlign | null,
): JSONContent {
  return {
    type,
    content: [
      paragraphNode(text, runs, {
        sourceRefs: [],
        origin: 'form',
        textAlign: align ?? null,
      }),
    ],
  };
}

/** body.json 的章节内容 → Tiptap JSON。 */
export function blocksToTiptap(blocks: ReportBlock[]): JSONContent[] {
  const content: JSONContent[] = [];
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      content.push(
        paragraphNode(block.text, block.runs, {
          sourceRefs: normalizeRefs(block.sourceRefs),
          origin: normalizeOrigin(block.origin),
          textAlign: block.align ?? null,
        }),
      );
      continue;
    }
    if (block.type === 'bullets') {
      content.push({
        type: 'bulletList',
        attrs: {
          sourceRefs: normalizeRefs(block.sourceRefs),
          origin: normalizeOrigin(block.origin),
        },
        content: block.items.map((item, index) => ({
          type: 'listItem',
          content: [
            paragraphNode(item, block.itemRuns?.[index], {
              sourceRefs: normalizeRefs(block.sourceRefs),
              origin: normalizeOrigin(block.origin),
              textAlign: block.itemAlign?.[index] ?? null,
            }),
          ],
        })),
      });
      continue;
    }
    if (block.type === 'table') {
      const columns = block.columns ?? [];
      if (columns.length === 0) continue;
      const rows: JSONContent[] = [
        {
          type: 'tableRow',
          content: columns.map((column, index) =>
            tableCellNode(
              'tableHeader',
              column,
              block.columnRuns?.[index],
              block.columnAlign?.[index],
            ),
          ),
        },
      ];
      (block.rows ?? []).forEach((row, rowIndex) => {
        rows.push({
          type: 'tableRow',
          content: columns.map((_, index) =>
            tableCellNode(
              'tableCell',
              String(row[index] ?? ''),
              block.rowRuns?.[rowIndex]?.[index],
              block.rowAlign?.[rowIndex]?.[index],
            ),
          ),
        });
      });
      content.push({
        type: 'table',
        attrs: {
          sourceRefs: normalizeRefs(block.sourceRefs),
          origin: normalizeOrigin(block.origin),
        },
        content: rows,
      });
    }
  }
  return content;
}

/** 空章节也要给 Tiptap 一个可编辑段落。 */
export function sectionToTiptap(section: ReportSection): JSONContent {
  const content = blocksToTiptap(section.blocks);
  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  };
}

function paragraphFromNode(node: JSONContent): ReportBlock | null {
  const inline = inlineFromContent(node.content);
  if (!inline.text.trim()) return null;
  const block: ReportBlock = {
    type: 'paragraph',
    text: inline.text,
    sourceRefs: normalizeRefs(node.attrs?.sourceRefs),
    origin: normalizeOrigin(node.attrs?.origin ?? 'user'),
  };
  const align = normalizeAlign(node.attrs?.textAlign);
  if (align) block.align = align;
  if (inline.runs) block.runs = inline.runs;
  return block;
}

function bulletsFromNode(node: JSONContent): ReportBlock | null {
  const items: string[] = [];
  const itemRuns: ReportTextRun[][] = [];
  const itemAlign: Array<ReportTextAlign | undefined> = [];
  const inheritedRefs: string[] = [];
  let inheritedOrigin: ReportBlockOrigin | null = null;
  for (const item of node.content ?? []) {
    if (item.type !== 'listItem') continue;
    const inline = inlineFromBlocks(item.content);
    if (!inline.text.trim()) continue;
    items.push(inline.text);
    itemRuns.push(inline.runs ?? []);
    itemAlign.push(inline.align);
    for (const child of item.content ?? []) {
      if (child.type !== 'paragraph') continue;
      const refs = normalizeRefs(child.attrs?.sourceRefs);
      if (refs.length > 0) {
        inheritedRefs.push(...refs);
        if (inheritedOrigin === null) {
          inheritedOrigin = normalizeOrigin(child.attrs?.origin ?? 'form');
        }
      }
    }
  }
  if (items.length === 0) return null;
  const listRefs = normalizeRefs(node.attrs?.sourceRefs);
  const block: ReportBlock = {
    type: 'bullets',
    items,
    sourceRefs: listRefs.length > 0 ? listRefs : [...new Set(inheritedRefs)],
    origin:
      listRefs.length > 0
        ? normalizeOrigin(node.attrs?.origin ?? 'user')
        : inheritedOrigin ?? normalizeOrigin(node.attrs?.origin ?? 'user'),
  };
  if (itemRuns.some((runs) => runs.length > 0)) block.itemRuns = itemRuns;
  if (itemAlign.some(Boolean)) {
    block.itemAlign = itemAlign.map((align) => align ?? null);
  }
  return block;
}

function tableFromNode(node: JSONContent): ReportBlock | null {
  const rowNodes = (node.content ?? []).filter((row) => row.type === 'tableRow');
  if (rowNodes.length === 0) return null;
  const cellsOf = (row: JSONContent): InlineResult[] =>
    (row.content ?? [])
      .filter((cell) => cell.type === 'tableCell' || cell.type === 'tableHeader')
      .map((cell) => inlineFromBlocks(cell.content));
  const header = cellsOf(rowNodes[0]);
  if (header.length === 0) return null;
  const columns = header.map((cell) => cell.text);
  const columnRuns = header.map((cell) => cell.runs ?? []);
  const columnAlign = header.map((cell) => cell.align);
  const rows: string[][] = [];
  const rowRuns: ReportTextRun[][][] = [];
  const rowAlign: Array<Array<ReportTextAlign | undefined>> = [];
  for (const row of rowNodes.slice(1)) {
    const cells = cellsOf(row);
    rows.push(columns.map((_, index) => cells[index]?.text ?? ''));
    rowRuns.push(columns.map((_, index) => cells[index]?.runs ?? []));
    rowAlign.push(columns.map((_, index) => cells[index]?.align));
  }
  const block: ReportBlock = {
    type: 'table',
    columns,
    rows,
    sourceRefs: normalizeRefs(node.attrs?.sourceRefs),
    origin: normalizeOrigin(node.attrs?.origin ?? 'user'),
  };
  if (columnRuns.some((runs) => runs.length > 0)) block.columnRuns = columnRuns;
  if (rowRuns.some((row) => row.some((runs) => runs.length > 0))) block.rowRuns = rowRuns;
  if (columnAlign.some(Boolean)) {
    block.columnAlign = columnAlign.map((align) => align ?? null);
  }
  if (rowAlign.some((row) => row.some(Boolean))) {
    block.rowAlign = rowAlign.map((row) => row.map((align) => align ?? null));
  }
  return block;
}

/** Tiptap JSON → body.json 的章节内容。 */
export function tiptapToBlocks(content: JSONContent[] | undefined): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  for (const node of content ?? []) {
    if (node.type === 'paragraph') {
      const block = paragraphFromNode(node);
      if (block) blocks.push(block);
    } else if (node.type === 'bulletList') {
      const block = bulletsFromNode(node);
      if (block) blocks.push(block);
    } else if (node.type === 'table') {
      const block = tableFromNode(node);
      if (block) blocks.push(block);
    }
  }
  return blocks;
}

export function sectionFromTiptap(content: JSONContent[] | undefined): ReportBlock[] {
  return tiptapToBlocks(content);
}
