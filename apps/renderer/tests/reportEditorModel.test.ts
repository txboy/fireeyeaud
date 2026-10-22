import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import type { ReportBlock } from '@fireeyeaud/shared';
import {
  blocksToTiptap,
  sectionToTiptap,
  tiptapToBlocks,
} from '../src/components/reports/editor/reportEditorModel.ts';
import { reportEditorExtensions } from '../src/components/reports/editor/reportEditorExtensions.ts';

test('paragraph round-trip keeps text, marks and audit metadata', () => {
  const blocks: ReportBlock[] = [
    {
      type: 'paragraph',
      text: '合同金额为 120 万元',
      sourceRefs: ['QZ-0001'],
      origin: 'form',
      align: 'center',
      runs: [
        { text: '合同金额为 ', bold: true },
        { text: '120 万元', italic: true, underline: true },
      ],
    },
  ];

  const parsed = tiptapToBlocks(blocksToTiptap(blocks));
  assert.deepEqual(parsed, blocks);
});

test('bullet list round-trip keeps per-item formatting', () => {
  const blocks: ReportBlock[] = [
    {
      type: 'bullets',
      items: ['第一项', '第二项（补充）'],
      sourceRefs: ['QZ-0002', 'QZ-0003'],
      origin: 'user',
      itemAlign: ['left', 'right'],
      itemRuns: [
        [{ text: '第一项', bold: true }],
        [{ text: '第二项' }, { text: '（补充）', italic: true }],
      ],
    },
  ];

  const parsed = tiptapToBlocks(blocksToTiptap(blocks));
  assert.deepEqual(parsed, blocks);
});

test('table round-trip keeps header, rows and cell runs', () => {
  const blocks: ReportBlock[] = [
    {
      type: 'table',
      columns: ['项目', '金额'],
      rows: [
        ['合同价', '120 万'],
        ['结算价', '110 万'],
      ],
      sourceRefs: ['QZ-0004'],
      origin: 'model',
      columnRuns: [
        [{ text: '项目', bold: true }],
        [{ text: '金额', bold: true }],
      ],
      columnAlign: ['center', 'right'],
      rowRuns: [
        [[], [{ text: '120 万', underline: true }]],
        [[], []],
      ],
      rowAlign: [
        ['left', 'center'],
        ['left', 'right'],
      ],
    },
  ];

  const parsed = tiptapToBlocks(blocksToTiptap(blocks));
  assert.deepEqual(parsed, blocks);
});

test('empty section still gives the editor an editable paragraph', () => {
  const doc = sectionToTiptap({
    id: 'S1',
    title: '基本情况',
    level: 1,
    goal: '',
    blocks: [],
  });
  assert.equal(doc.type, 'doc');
  assert.equal(doc.content?.[0]?.type, 'paragraph');
  assert.deepEqual(tiptapToBlocks(doc.content), []);
});

test('newly typed plain paragraph defaults to user origin and no source refs', () => {
  const blocks = tiptapToBlocks([
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '手工补充的说明' }],
    },
  ]);
  assert.deepEqual(blocks, [
    {
      type: 'paragraph',
      text: '手工补充的说明',
      sourceRefs: [],
      origin: 'user',
    },
  ]);
});

test('toggling a cited paragraph into a list keeps its source refs', () => {
  const blocks = tiptapToBlocks([
    {
      type: 'bulletList',
      attrs: { sourceRefs: [], origin: 'user' },
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              attrs: { sourceRefs: ['QZ-0001'], origin: 'form' },
              content: [{ type: 'text', text: '采购费用99元。' }],
            },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(blocks, [
    {
      type: 'bullets',
      items: ['采购费用99元。'],
      sourceRefs: ['QZ-0001'],
      origin: 'form',
    },
  ]);
});

test('generated content satisfies the editor schema', () => {
  const schema = getSchema(reportEditorExtensions());
  const blocks: ReportBlock[] = [
    {
      type: 'paragraph',
      text: '采购阿里云服务器，费用99元。',
      sourceRefs: ['QZ-0001'],
      origin: 'form',
    },
    {
      type: 'bullets',
      items: ['费用已在信息化费列支'],
      sourceRefs: ['QZ-0001'],
      origin: 'form',
    },
    {
      type: 'table',
      columns: ['项目', '金额'],
      rows: [['费用', '99元']],
      sourceRefs: ['QZ-0001'],
      origin: 'form',
    },
  ];

  const doc = schema.nodeFromJSON({ type: 'doc', content: blocksToTiptap(blocks) });
  assert.equal(doc.type.name, 'doc');
  assert.equal(doc.childCount, 3);
  assert.equal(doc.child(0).type.name, 'paragraph');
  assert.deepEqual(doc.child(0).attrs.sourceRefs, ['QZ-0001']);
  assert.equal(doc.child(1).type.name, 'bulletList');
  assert.equal(doc.child(2).type.name, 'table');
  assert.equal(doc.child(2).childCount, 2);
});
