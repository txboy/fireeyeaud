import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rendererSrc = join(here, '..', 'src');

function read(rel: string): string {
  return readFileSync(join(rendererSrc, rel), 'utf8');
}

test('template list renders no placeholder check line', () => {
  const panel = read('components/panels/TemplatesPanel.tsx');
  assert.doesNotMatch(panel, /tpl-row__check/);
  assert.doesNotMatch(panel, /item\.check|check\.tags|check\.loops|scan/);
});

test('template upload form renders no placeholder check line', () => {
  const form = read('components/forms/TemplateForm.tsx');
  assert.doesNotMatch(form, /tpl-row__check/);
  assert.doesNotMatch(form, /TemplateCheck|setCheck|check\.tags|check\.loops/);
});

test('shared types no longer expose a template check payload', () => {
  const types = readFileSync(join(here, '..', '..', '..', 'packages', 'shared', 'src', 'types.ts'), 'utf8');
  assert.doesNotMatch(types, /TemplateCheck/);
  assert.doesNotMatch(types, /^\s+check: TemplateCheck;/m);
});