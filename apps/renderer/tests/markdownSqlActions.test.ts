import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSqlLanguage } from '../src/lib/sqlLanguage.ts';

test('recognizes every SQL dialect the assistant may emit', () => {
  for (const lang of ['sql', 'mysql', 'postgres', 'postgresql', 'sqlite', 'tsql', 'plsql']) {
    assert.equal(isSqlLanguage(lang), true, `${lang} should be treated as SQL`);
  }
});

test('is case-insensitive and tolerates surrounding blank space', () => {
  assert.equal(isSqlLanguage('SQL'), true);
  assert.equal(isSqlLanguage('MySQL'), true);
  assert.equal(isSqlLanguage(' sql '), true);
});

test('does not treat other languages as SQL', () => {
  for (const lang of ['', 'text', 'json', 'python', 'bash', 'ts']) {
    assert.equal(isSqlLanguage(lang), false, `${lang} should not be SQL`);
  }
});