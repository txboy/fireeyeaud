'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isInsideWorkspace } = require('./file-preview.cjs');

/**
 * 工作区文件操作（复制 / 移动 / 新建 / 重命名）。
 * 全部限定在工作区内；禁止操作 `.fireeye` 目录及其内部内容。
 * 复制 / 移动 / 重命名遇同名自动追加序号（如「报表 (1).xlsx」）。
 */

const PROTECTED_NAME = '.fireeye';
const INVALID_CHARS = /[\\/:*?"<>|]/;

/** 相对根目录的首段是否为受保护的 `.fireeye`。 */
function isProtected(root, target) {
  if (typeof root !== 'string' || typeof target !== 'string') return false;
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(target);
  const rel = path.relative(rootAbs, targetAbs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return rel.split(path.sep)[0] === PROTECTED_NAME;
}

/** 校验单个名称（不含路径分隔符与非法字符）。返回 null 表示合法。 */
function validateName(name) {
  if (typeof name !== 'string') return { ok: false, code: 'E_INVALID_NAME' };
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || INVALID_CHARS.test(trimmed)) {
    return { ok: false, code: 'E_INVALID_NAME' };
  }
  if (trimmed === PROTECTED_NAME) return { ok: false, code: 'E_PROTECTED' };
  return null;
}

/** 在 dir 下返回不与现有文件冲突的名称（同名则追加 (1)/(2)…）。 */
function uniqueName(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  let index = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${index})${ext}`;
    index += 1;
  }
  return candidate;
}

/** 复制外部 / 工作区文件到工作区内的目标目录。 */
function copyInto({ root, targetDir, sourcePaths } = {}) {
  if (
    typeof root !== 'string' ||
    typeof targetDir !== 'string' ||
    !Array.isArray(sourcePaths)
  ) {
    return { ok: false, code: 'E_OP_FAILED' };
  }
  if (!isInsideWorkspace(root, targetDir) || isProtected(root, targetDir)) {
    return { ok: false, code: 'E_OUTSIDE_WORKSPACE' };
  }
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch {
    return { ok: false, code: 'E_OP_FAILED' };
  }
  const copied = [];
  for (const src of sourcePaths) {
    if (typeof src !== 'string' || !src) continue;
    const base = path.basename(src);
    if (!base) continue;
    const dest = path.join(targetDir, uniqueName(targetDir, base));
    try {
      fs.cpSync(src, dest, { recursive: true, errorOnExist: false });
    } catch {
      return { ok: false, code: 'E_OP_FAILED' };
    }
    copied.push(dest);
  }
  return { ok: true, paths: copied };
}

/** 把工作区内的文件 / 文件夹移动到另一个目录。 */
function move({ root, sourcePath, targetDir } = {}) {
  if (
    typeof root !== 'string' ||
    typeof sourcePath !== 'string' ||
    typeof targetDir !== 'string'
  ) {
    return { ok: false, code: 'E_OP_FAILED' };
  }
  if (!isInsideWorkspace(root, sourcePath) || !isInsideWorkspace(root, targetDir)) {
    return { ok: false, code: 'E_OUTSIDE_WORKSPACE' };
  }
  if (isProtected(root, sourcePath) || isProtected(root, targetDir)) {
    return { ok: false, code: 'E_PROTECTED' };
  }
  const srcAbs = path.resolve(sourcePath);
  const dstDirAbs = path.resolve(targetDir);
  if (srcAbs === path.resolve(root)) return { ok: false, code: 'E_ROOT' };
  if (!fs.existsSync(srcAbs)) return { ok: false, code: 'E_NOT_FOUND' };
  if (!fs.existsSync(dstDirAbs)) return { ok: false, code: 'E_NOT_FOUND' };
  if (path.dirname(srcAbs) === dstDirAbs) {
    return { ok: true, path: srcAbs, moved: false };
  }
  // 禁止把一个目录移动到它自己或其子目录内。
  const rel = path.relative(srcAbs, dstDirAbs);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return { ok: false, code: 'E_INTO_SELF' };
  }
  const dest = path.join(dstDirAbs, uniqueName(dstDirAbs, path.basename(srcAbs)));
  try {
    fs.renameSync(srcAbs, dest);
  } catch {
    try {
      fs.cpSync(srcAbs, dest, { recursive: true });
      fs.rmSync(srcAbs, { recursive: true });
    } catch {
      return { ok: false, code: 'E_OP_FAILED' };
    }
  }
  return { ok: true, path: dest, moved: true };
}

function createDir({ root, parentDir, name } = {}) {
  const invalid = validateName(name);
  if (invalid) return invalid;
  if (!isInsideWorkspace(root, parentDir) || isProtected(root, parentDir)) {
    return { ok: false, code: 'E_OUTSIDE_WORKSPACE' };
  }
  const target = path.join(parentDir, name.trim());
  if (fs.existsSync(target)) return { ok: false, code: 'E_EXISTS' };
  try {
    fs.mkdirSync(target);
  } catch {
    return { ok: false, code: 'E_OP_FAILED' };
  }
  return { ok: true, path: target };
}

function createFile({ root, parentDir, name } = {}) {
  const invalid = validateName(name);
  if (invalid) return invalid;
  if (!isInsideWorkspace(root, parentDir) || isProtected(root, parentDir)) {
    return { ok: false, code: 'E_OUTSIDE_WORKSPACE' };
  }
  const target = path.join(parentDir, name.trim());
  if (fs.existsSync(target)) return { ok: false, code: 'E_EXISTS' };
  try {
    fs.writeFileSync(target, '');
  } catch {
    return { ok: false, code: 'E_OP_FAILED' };
  }
  return { ok: true, path: target };
}

function rename({ root, filePath, newName } = {}) {
  const invalid = validateName(newName);
  if (invalid) return invalid;
  if (!isInsideWorkspace(root, filePath) || isProtected(root, filePath)) {
    return { ok: false, code: 'E_PROTECTED' };
  }
  const abs = path.resolve(filePath);
  if (abs === path.resolve(root)) return { ok: false, code: 'E_ROOT' };
  if (!fs.existsSync(abs)) return { ok: false, code: 'E_NOT_FOUND' };
  const trimmed = newName.trim();
  if (trimmed === path.basename(abs)) return { ok: true, path: abs, renamed: false };
  const parent = path.dirname(abs);
  const target = path.join(parent, uniqueName(parent, trimmed));
  try {
    fs.renameSync(abs, target);
  } catch {
    return { ok: false, code: 'E_OP_FAILED' };
  }
  return { ok: true, path: target, renamed: true };
}

module.exports = {
  copyInto,
  move,
  createDir,
  createFile,
  rename,
  uniqueName,
  validateName,
  isProtected,
};
