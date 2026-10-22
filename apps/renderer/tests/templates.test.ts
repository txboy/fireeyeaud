import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TemplateInfo } from '@fireeyeaud/shared';
import { pickDefaultTemplate } from '../src/lib/templates.ts';

function tpl(over: Partial<TemplateInfo>): TemplateInfo {
  return {
    id: 'tpl_1',
    scope: 'project',
    kind: 'report',
    name: 't',
    fileName: 'tpl_1.docx',
    absPath: 'C:/x/tpl_1.docx',
    size: 10,
    createdAt: '2026-01-01T00:00:00Z',
    isDefault: false,
    check: { tags: [], loops: [], unknown: [], missing: [], ok: true },
    ...over,
  };
}

test('returns null when the kind has no templates', () => {
  assert.equal(pickDefaultTemplate([], 'report'), null);
  assert.equal(
    pickDefaultTemplate([tpl({ kind: 'evidence-form' })], 'report'),
    null,
  );
});

test('project default beats global default', () => {
  const items = [
    tpl({ id: 'g', scope: 'global', isDefault: true }),
    tpl({ id: 'p', scope: 'project', isDefault: true }),
  ];
  assert.equal(pickDefaultTemplate(items, 'report')?.id, 'p');
});

test('global default beats a non-default project template', () => {
  // 计划 §Task 4 顺序：项目默认 → 全局默认 → 项目首条 → 全局首条
  const items = [
    tpl({ id: 'g', scope: 'global', isDefault: true }),
    tpl({ id: 'p1', scope: 'project' }),
    tpl({ id: 'p2', scope: 'project' }),
  ];
  assert.equal(pickDefaultTemplate(items, 'report')?.id, 'g');
});

test('uses the first project template when no default exists anywhere', () => {
  const items = [tpl({ id: 'p1', scope: 'project' }), tpl({ id: 'p2', scope: 'project' })];
  assert.equal(pickDefaultTemplate(items, 'report')?.id, 'p1');
});

test('falls back to the first global template', () => {
  const items = [tpl({ id: 'g1', scope: 'global' }), tpl({ id: 'g2', scope: 'global' })];
  assert.equal(pickDefaultTemplate(items, 'report')?.id, 'g1');
});

test('falls back to the builtin sample when nothing is uploaded', () => {
  const items = [tpl({ id: 'sample-report', scope: 'global', builtin: true })];
  assert.equal(pickDefaultTemplate(items, 'report')?.id, 'sample-report');
});

test('ignores builtin samples while a real template exists', () => {
  const items = [
    tpl({ id: 'sample-report', scope: 'global', builtin: true }),
    tpl({ id: 'p', scope: 'project' }),
  ];
  assert.equal(pickDefaultTemplate(items, 'report')?.id, 'p');
});

test('filters by kind', () => {
  const items = [
    tpl({ id: 'f', kind: 'evidence-form', scope: 'project', isDefault: true }),
    tpl({ id: 'r', kind: 'report', scope: 'project' }),
  ];
  assert.equal(pickDefaultTemplate(items, 'report')?.id, 'r');
});