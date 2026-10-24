import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rendererSrc = join(here, '..', 'src');
const localesDir = join(here, '..', '..', '..', 'packages', 'shared', 'src', 'locales');

function read(rel: string): string {
  return readFileSync(join(rendererSrc, rel), 'utf8');
}

test('archive lives in its own activity-bar panel', () => {
  const rail = read('components/ActivityRail.tsx');
  const sidebar = read('components/SideBar.tsx');
  assert.match(rail, /view: 'archive'/);
  assert.match(sidebar, /case 'archive':/);
  assert.ok(existsSync(join(rendererSrc, 'components/archive/ArchivePanel.tsx')));
});

test('results column no longer switches tabs or hosts the archive view', () => {
  const results = read('components/ResultsColumn.tsx');
  assert.doesNotMatch(results, /results__tab/);
  assert.doesNotMatch(results, /Archive/);
  assert.match(results, /results__title/);
  assert.equal(existsSync(join(rendererSrc, 'components/results/ArchiveView.tsx')), false);
});

test('the conflict dialog was replaced by the diff tab', () => {
  assert.equal(existsSync(join(rendererSrc, 'components/archive/ConflictDialog.tsx')), false);
  const diff = read('components/archive/ArchiveDiffTab.tsx');
  assert.match(diff, /describeConflict/);
  assert.match(diff, /conflicts\.map/);
});

test('archive panels render every translation key they use', () => {
  for (const [file, locale] of [
    ['zh-CN.ts', 'zh'],
    ['en-US.ts', 'en'],
  ] as const) {
    const source = readFileSync(join(localesDir, file), 'utf8');
    const ns = source.slice(source.indexOf('  archive: {'));
    const block = ns.slice(0, ns.indexOf('\n  error: {'));
    const files = [
      'components/archive/ArchivePanel.tsx',
      'components/archive/ArchiveDiffTab.tsx',
      'components/archive/ArchiveChangesTab.tsx',
      'components/archive/ArchiveRemoteTab.tsx',
    ];
    for (const rel of files) {
      const text = read(rel);
      for (const match of text.matchAll(/\bt\('([A-Za-z][\w.]*)'/g)) {
        const key = match[1];
        if (key.startsWith('count')) {
          assert.match(block, new RegExp(`\\b${key}:`), `${locale} missing ${key}`);
          continue;
        }
        assert.match(block, new RegExp(`\\b${key}:`), `${locale} missing ${key} in ${rel}`);
      }
    }
  }
});