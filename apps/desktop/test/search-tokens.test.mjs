import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseTokens, tokenMatches, isExcluded, isIncluded } = require('../src/search-tokens.cjs');

// --- parseTokens ----------------------------------------------------------

test('parseTokens accepts an array and trims/dedupes', () => {
  assert.deepEqual(parseTokens([' docs/ ', 'docs/', 'a.md', '',  '  ']), ['docs/', 'a.md']);
});

test('parseTokens splits a legacy string on commas/whitespace', () => {
  assert.deepEqual(parseTokens('docs/  a.md,b.md'), ['docs/', 'a.md', 'b.md']);
});

test('parseTokens handles empty/undefined', () => {
  assert.deepEqual(parseTokens(undefined), []);
  assert.deepEqual(parseTokens(''), []);
});

// --- tokenMatches: folders (subtree) --------------------------------------

test('folder token matches its subtree and itself', () => {
  assert.equal(tokenMatches('docs', 'docs/'), true);
  assert.equal(tokenMatches('docs/a.md', 'docs/'), true);
  assert.equal(tokenMatches('docs/sub/b.md', 'docs/'), true);
});

test('folder token does not match prefix-siblings or nested elsewhere', () => {
  assert.equal(tokenMatches('docs2/a.md', 'docs/'), false);
  assert.equal(tokenMatches('other/docs/a.md', 'docs/'), false);
});

test('nested folder token matches only that subtree', () => {
  assert.equal(tokenMatches('src/ui/button.tsx', 'src/ui/'), true);
  assert.equal(tokenMatches('src/ui-old/button.tsx', 'src/ui/'), false);
  assert.equal(tokenMatches('src/lib/x.ts', 'src/ui/'), false);
});

test('folder token is normalised for windows separators and leading slashes', () => {
  assert.equal(tokenMatches('docs\\a.md', '/docs/'), true);
  assert.equal(tokenMatches('docs/a.md', 'docs\\'), true);
});

// --- tokenMatches: files (exact) ------------------------------------------

test('file token matches exactly one path', () => {
  assert.equal(tokenMatches('docs/a.md', 'docs/a.md'), true);
  assert.equal(tokenMatches('docs/a.md.bak', 'docs/a.md'), false);
  assert.equal(tokenMatches('other/a.md', 'docs/a.md'), false);
  assert.equal(tokenMatches('docs/a.md', 'a.md'), false);
});

test('empty token never matches', () => {
  assert.equal(tokenMatches('docs/a.md', ''), false);
  assert.equal(tokenMatches('docs/a.md', '/'), false);
});

// --- isIncluded / isExcluded ----------------------------------------------

test('isIncluded: no tokens means everything', () => {
  assert.equal(isIncluded('anything/x.txt', []), true);
});

test('isIncluded: any matching token includes', () => {
  const tokens = parseTokens(['docs/', 'a.md']);
  assert.equal(isIncluded('docs/z.md', tokens), true);
  assert.equal(isIncluded('a.md', tokens), true);
  assert.equal(isIncluded('src/z.md', tokens), false);
});

test('isExcluded: any matching token excludes', () => {
  const tokens = parseTokens(['node_modules/', 'secret.txt']);
  assert.equal(isExcluded('node_modules/a.js', tokens), true);
  assert.equal(isExcluded('sub/secret.txt', tokens), false);
  assert.equal(isExcluded('secret.txt', tokens), true);
  assert.equal(isExcluded('src/a.ts', tokens), false);
});
