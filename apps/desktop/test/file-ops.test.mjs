import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { copyInto, move, createDir, createFile, rename, uniqueName, validateName } = require(
  '../src/file-ops.cjs',
);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fireeyeaud-fileops-'));
}

function write(root, name, content) {
  const abs = path.join(root, name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

// --- copyInto -------------------------------------------------------------

test('copies an external file into the workspace', () => {
  const root = tmpDir();
  const other = tmpDir();
  const src = write(other, 'report.csv', 'a,b\n');
  const res = copyInto({ root, targetDir: root, sourcePaths: [src] });
  assert.equal(res.ok, true);
  assert.equal(res.paths.length, 1);
  assert.equal(fs.readFileSync(path.join(root, 'report.csv'), 'utf8'), 'a,b\n');
});

test('copies a directory recursively into a subfolder', () => {
  const root = tmpDir();
  const other = tmpDir();
  write(other, 'bundle/a.txt', 'x');
  write(other, 'bundle/nested/b.txt', 'y');
  const target = path.join(root, 'dest');
  fs.mkdirSync(target);
  const res = copyInto({ root, targetDir: target, sourcePaths: [path.join(other, 'bundle')] });
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(path.join(target, 'bundle', 'nested', 'b.txt'), 'utf8'), 'y');
});

test('auto-renames on name conflict', () => {
  const root = tmpDir();
  const other = tmpDir();
  write(root, 'data.csv', 'old');
  const src = write(other, 'data.csv', 'new');
  const res = copyInto({ root, targetDir: root, sourcePaths: [src] });
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(path.join(root, 'data.csv'), 'utf8'), 'old');
  assert.equal(fs.readFileSync(path.join(root, 'data (1).csv'), 'utf8'), 'new');
});

test('rejects copying into .fireeye', () => {
  const root = tmpDir();
  const other = tmpDir();
  const src = write(other, 'x.txt', 'x');
  const res = copyInto({ root, targetDir: path.join(root, '.fireeye'), sourcePaths: [src] });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_OUTSIDE_WORKSPACE');
});

test('rejects copying into a target outside the workspace', () => {
  const root = tmpDir();
  const other = tmpDir();
  const src = write(other, 'x.txt', 'x');
  const res = copyInto({ root, targetDir: other, sourcePaths: [src] });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_OUTSIDE_WORKSPACE');
});

// --- move -----------------------------------------------------------------

test('moves a file into a subfolder', () => {
  const root = tmpDir();
  const file = write(root, 'a.txt', 'x');
  const dest = path.join(root, 'sub');
  fs.mkdirSync(dest);
  const res = move({ root, sourcePath: file, targetDir: dest });
  assert.equal(res.ok, true);
  assert.equal(res.moved, true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(path.join(dest, 'a.txt')), true);
});

test('moving into the same directory is a no-op', () => {
  const root = tmpDir();
  const file = write(root, 'a.txt', 'x');
  const res = move({ root, sourcePath: file, targetDir: root });
  assert.equal(res.ok, true);
  assert.equal(res.moved, false);
  assert.equal(fs.existsSync(file), true);
});

test('auto-renames when the move target already exists', () => {
  const root = tmpDir();
  const file = write(root, 'a.txt', 'x');
  const dest = path.join(root, 'sub');
  write(root, 'sub/a.txt', 'y');
  const res = move({ root, sourcePath: file, targetDir: dest });
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(path.join(dest, 'a (1).txt'), 'utf8'), 'x');
});

test('rejects moving a folder into itself', () => {
  const root = tmpDir();
  const dir = path.join(root, 'outer');
  const inner = path.join(dir, 'inner');
  fs.mkdirSync(inner, { recursive: true });
  const res = move({ root, sourcePath: dir, targetDir: inner });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_INTO_SELF');
});

test('rejects moving outside the workspace', () => {
  const root = tmpDir();
  const other = tmpDir();
  const file = write(root, 'a.txt', 'x');
  const res = move({ root, sourcePath: file, targetDir: other });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_OUTSIDE_WORKSPACE');
});

test('rejects moving the workspace root', () => {
  const root = tmpDir();
  const dest = path.join(root, 'sub');
  fs.mkdirSync(dest);
  const res = move({ root, sourcePath: root, targetDir: dest });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_ROOT');
});

test('rejects moving .fireeye contents', () => {
  const root = tmpDir();
  const inner = write(root, '.fireeye/index.json', 'x');
  const dest = path.join(root, 'sub');
  fs.mkdirSync(dest);
  const res = move({ root, sourcePath: inner, targetDir: dest });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'E_PROTECTED');
});

// --- createDir / createFile ----------------------------------------------

test('creates a folder and a file', () => {
  const root = tmpDir();
  const dirRes = createDir({ root, parentDir: root, name: '新建文件夹' });
  assert.equal(dirRes.ok, true);
  assert.equal(fs.statSync(dirRes.path).isDirectory(), true);
  const fileRes = createFile({ root, parentDir: dirRes.path, name: 'note.txt' });
  assert.equal(fileRes.ok, true);
  assert.equal(fs.readFileSync(fileRes.path, 'utf8'), '');
});

test('rejects an invalid name', () => {
  const root = tmpDir();
  for (const name of ['', '  ', '.', '..', 'a/b', 'a\\b', 'x:y']) {
    assert.equal(createDir({ root, parentDir: root, name }).code, 'E_INVALID_NAME', name);
    assert.equal(createFile({ root, parentDir: root, name }).code, 'E_INVALID_NAME', name);
  }
});

test('rejects an existing name', () => {
  const root = tmpDir();
  write(root, 'a.txt', 'x');
  assert.equal(createFile({ root, parentDir: root, name: 'a.txt' }).code, 'E_EXISTS');
});

test('rejects creating inside .fireeye', () => {
  const root = tmpDir();
  assert.equal(
    createDir({ root, parentDir: path.join(root, '.fireeye'), name: 'x' }).code,
    'E_OUTSIDE_WORKSPACE',
  );
});

test('rejects creating a name reserved for .fireeye', () => {
  const root = tmpDir();
  assert.equal(createDir({ root, parentDir: root, name: '.fireeye' }).code, 'E_PROTECTED');
});

// --- rename ---------------------------------------------------------------

test('renames a file', () => {
  const root = tmpDir();
  const file = write(root, 'old.txt', 'x');
  const res = rename({ root, filePath: file, newName: 'new.txt' });
  assert.equal(res.ok, true);
  assert.equal(res.renamed, true);
  assert.equal(fs.existsSync(path.join(root, 'new.txt')), true);
  assert.equal(fs.existsSync(file), false);
});

test('auto-renames when the rename target exists', () => {
  const root = tmpDir();
  const file = write(root, 'a.txt', 'x');
  write(root, 'b.txt', 'y');
  const res = rename({ root, filePath: file, newName: 'b.txt' });
  assert.equal(res.ok, true);
  assert.equal(fs.existsSync(path.join(root, 'b (1).txt')), true);
  assert.equal(fs.readFileSync(path.join(root, 'b.txt'), 'utf8'), 'y');
});

test('rejects renaming to an invalid name', () => {
  const root = tmpDir();
  const file = write(root, 'a.txt', 'x');
  assert.equal(rename({ root, filePath: file, newName: 'a/b' }).code, 'E_INVALID_NAME');
});

test('rejects renaming the workspace root', () => {
  const root = tmpDir();
  assert.equal(rename({ root, filePath: root, newName: 'x' }).code, 'E_ROOT');
});

test('rejects renaming .fireeye content', () => {
  const root = tmpDir();
  const inner = write(root, '.fireeye/index.json', 'x');
  assert.equal(rename({ root, filePath: inner, newName: 'other.json' }).code, 'E_PROTECTED');
});

// --- helpers --------------------------------------------------------------

test('uniqueName appends an incrementing suffix', () => {
  const root = tmpDir();
  write(root, 'data.csv', 'x');
  write(root, 'data (1).csv', 'x');
  assert.equal(uniqueName(root, 'data.csv'), 'data (2).csv');
  assert.equal(uniqueName(root, 'fresh.csv'), 'fresh.csv');
});

test('validateName accepts ordinary names', () => {
  assert.equal(validateName('报表 2024.xlsx'), null);
});
