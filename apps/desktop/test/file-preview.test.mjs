import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readFileContent, writeTextFile, deletePath } = require('../src/file-preview.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fireeyeaud-preview-'));
}

function write(root, name, content) {
  const abs = path.join(root, name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

// --- read: text -----------------------------------------------------------

test('reads a text file within the workspace', () => {
  const root = tmpDir();
  const file = write(root, 'notes.md', '# hello\n');
  const res = readFileContent({ root, filePath: file });
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'text');
  assert.equal(res.text, '# hello\n');
  assert.equal(res.size, 8);
});

test('classifies csv as editable text', () => {
  const root = tmpDir();
  const file = write(root, 'data.csv', 'a,b\n1,2\n');
  const res = readFileContent({ root, filePath: file });
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'text');
});

// --- read: binary ---------------------------------------------------------

test('classifies images as base64 with mime', () => {
  const root = tmpDir();
  const file = write(root, 'logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const res = readFileContent({ root, filePath: file });
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'base64');
  assert.equal(res.mime, 'image/png');
  assert.equal(res.data, Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'));
});

test('classifies pdf/docx/xlsx as base64 with mime', () => {
  const root = tmpDir();
  const cases = [
    ['a.pdf', 'application/pdf'],
    ['a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['a.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
  ];
  for (const [name, mime] of cases) {
    const file = write(root, name, Buffer.from('x'));
    const res = readFileContent({ root, filePath: file });
    assert.equal(res.ok, true, name);
    assert.equal(res.kind, 'base64', name);
    assert.equal(res.mime, mime, name);
  }
});

// --- read: failures -------------------------------------------------------

test('rejects unsupported extension', () => {
  const root = tmpDir();
  const file = write(root, 'archive.zip', 'x');
  const res = readFileContent({ root, filePath: file });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_UNSUPPORTED');
});

test('rejects a path outside the workspace', () => {
  const root = tmpDir();
  const other = tmpDir();
  const file = write(other, 'secret.txt', 'nope');
  const res = readFileContent({ root, filePath: file });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_OUTSIDE_WORKSPACE');
});

test('rejects a missing file', () => {
  const root = tmpDir();
  const res = readFileContent({ root, filePath: path.join(root, 'ghost.txt') });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_NOT_FOUND');
});

test('rejects an oversized text file', () => {
  const root = tmpDir();
  const file = write(root, 'big.txt', 'x'.repeat(100));
  const res = readFileContent({ root, filePath: file, maxTextBytes: 10 });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_TOO_LARGE');
  assert.equal(res.size, 100);
});

test('rejects an oversized binary file', () => {
  const root = tmpDir();
  const file = write(root, 'big.png', Buffer.alloc(100));
  const res = readFileContent({ root, filePath: file, maxBinaryBytes: 10 });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_TOO_LARGE');
});

// --- write ----------------------------------------------------------------

test('writes text and round-trips', () => {
  const root = tmpDir();
  const file = write(root, 'notes.md', 'old');
  const res = writeTextFile({ root, filePath: file, text: 'new content' });
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'new content');
  const back = readFileContent({ root, filePath: file });
  assert.equal(back.text, 'new content');
});

test('writes a new text file', () => {
  const root = tmpDir();
  const file = path.join(root, 'created.txt');
  const res = writeTextFile({ root, filePath: file, text: 'hi' });
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'hi');
});

test('rejects writing a non-editable extension', () => {
  const root = tmpDir();
  const file = write(root, 'a.pdf', 'x');
  const res = writeTextFile({ root, filePath: file, text: 'x' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_NOT_EDITABLE');
  assert.equal(fs.readFileSync(file, 'utf8'), 'x');
});

test('rejects writing outside the workspace', () => {
  const root = tmpDir();
  const other = tmpDir();
  const file = write(other, 'a.txt', 'x');
  const res = writeTextFile({ root, filePath: file, text: 'y' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_OUTSIDE_WORKSPACE');
});

test('rejects writing oversized text', () => {
  const root = tmpDir();
  const file = write(root, 'a.txt', 'x');
  const res = writeTextFile({ root, filePath: file, text: 'x'.repeat(100), maxBytes: 10 });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_TOO_LARGE');
});

// --- delete ---------------------------------------------------------------

test('deletes a file', () => {
  const root = tmpDir();
  const file = write(root, 'a.txt', 'x');
  const res = deletePath({ root, filePath: file });
  assert.equal(res.ok, true);
  assert.equal(fs.existsSync(file), false);
});

test('deletes an empty directory', () => {
  const root = tmpDir();
  const dir = path.join(root, 'empty');
  fs.mkdirSync(dir);
  const res = deletePath({ root, filePath: dir });
  assert.equal(res.ok, true);
  assert.equal(fs.existsSync(dir), false);
});

test('deletes a non-empty directory recursively', () => {
  const root = tmpDir();
  write(root, 'dir/nested/b.txt', 'x');
  const res = deletePath({ root, filePath: path.join(root, 'dir') });
  assert.equal(res.ok, true);
  assert.equal(fs.existsSync(path.join(root, 'dir')), false);
});

test('rejects deleting outside the workspace', () => {
  const root = tmpDir();
  const other = tmpDir();
  const file = write(other, 'a.txt', 'x');
  const res = deletePath({ root, filePath: file });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_OUTSIDE_WORKSPACE');
  assert.equal(fs.existsSync(file), true);
});

test('rejects deleting the workspace root', () => {
  const root = tmpDir();
  const res = deletePath({ root, filePath: root });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_DELETE_ROOT');
  assert.equal(fs.existsSync(root), true);
});

test('rejects deleting .fireeye and its contents', () => {
  const root = tmpDir();
  const dir = path.join(root, '.fireeye');
  fs.mkdirSync(dir);
  const inner = write(root, '.fireeye/index.json', 'x');
  assert.equal(deletePath({ root, filePath: dir }).code, 'E_PROTECTED');
  assert.equal(deletePath({ root, filePath: inner }).code, 'E_PROTECTED');
  assert.equal(fs.existsSync(dir), true);
  assert.equal(fs.existsSync(inner), true);
});

test('rejects deleting a missing path', () => {
  const root = tmpDir();
  const res = deletePath({ root, filePath: path.join(root, 'ghost.txt') });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_NOT_FOUND');
});
