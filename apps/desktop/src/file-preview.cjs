'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 工作区文件读取 / 文本写入（供资源管理器与搜索预览使用）。
 * 所有访问都限定在工作区根目录内；按扩展名分类，超出大小上限则拒绝。
 */

// 纯文本（可预览、可编辑）。
const TEXT_EXT = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonl',
  '.log',
  '.yaml',
  '.yml',
  '.xml',
  '.csv',
  '.tsv',
  '.ini',
  '.conf',
  '.cfg',
  '.toml',
  '.env',
  '.sql',
  '.py',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.less',
  '.html',
  '.htm',
  '.sh',
  '.bat',
  '.ps1',
  '.gitignore',
]);

// 图片 → mime。
const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// 二进制文档 → mime。
const DOC_MIME = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
};

const DEFAULT_MAX_TEXT_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_BINARY_BYTES = 30 * 1024 * 1024;

/** 目标是否位于工作区根目录内（含根本身）。 */
function isInsideWorkspace(root, target) {
  if (typeof root !== 'string' || typeof target !== 'string') return false;
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(target);
  const rel = path.relative(rootAbs, targetAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 按扩展名返回分类：'text' | 'image' | 'doc' | 'unsupported'。 */
function classifyExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXT.has(ext)) return { kind: 'text', ext };
  if (IMAGE_MIME[ext]) return { kind: 'image', ext, mime: IMAGE_MIME[ext] };
  if (DOC_MIME[ext]) return { kind: 'doc', ext, mime: DOC_MIME[ext] };
  return { kind: 'unsupported', ext };
}

function readFileContent({
  root,
  filePath,
  maxTextBytes = DEFAULT_MAX_TEXT_BYTES,
  maxBinaryBytes = DEFAULT_MAX_BINARY_BYTES,
} = {}) {
  if (!isInsideWorkspace(root, filePath)) {
    return { ok: false, code: 'E_OUTSIDE_WORKSPACE' };
  }
  const classified = classifyExt(filePath);
  if (classified.kind === 'unsupported') {
    return { ok: false, code: 'E_UNSUPPORTED', ext: classified.ext };
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { ok: false, code: 'E_NOT_FOUND' };
  }
  if (!stat.isFile()) return { ok: false, code: 'E_NOT_FOUND' };

  const isText = classified.kind === 'text';
  const limit = isText ? maxTextBytes : maxBinaryBytes;
  if (stat.size > limit) {
    return {
      ok: false,
      code: 'E_TOO_LARGE',
      size: stat.size,
      kind: isText ? 'text' : 'base64',
    };
  }

  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return { ok: false, code: 'E_READ_FAILED' };
  }

  if (isText) {
    return { ok: true, kind: 'text', text: buf.toString('utf8'), size: stat.size, path: filePath };
  }
  return {
    ok: true,
    kind: 'base64',
    data: buf.toString('base64'),
    mime: classified.mime,
    size: stat.size,
    path: filePath,
  };
}

function writeTextFile({
  root,
  filePath,
  text,
  maxBytes = DEFAULT_MAX_TEXT_BYTES,
} = {}) {
  if (!isInsideWorkspace(root, filePath)) {
    return { ok: false, code: 'E_OUTSIDE_WORKSPACE' };
  }
  const classified = classifyExt(filePath);
  if (classified.kind !== 'text') {
    return { ok: false, code: 'E_NOT_EDITABLE' };
  }
  if (typeof text !== 'string') {
    return { ok: false, code: 'E_WRITE_FAILED' };
  }
  const size = Buffer.byteLength(text, 'utf8');
  if (size > maxBytes) {
    return { ok: false, code: 'E_TOO_LARGE', size };
  }
  try {
    fs.writeFileSync(filePath, text, 'utf8');
  } catch {
    return { ok: false, code: 'E_WRITE_FAILED' };
  }
  return { ok: true, path: filePath, size };
}

module.exports = {
  readFileContent,
  writeTextFile,
  isInsideWorkspace,
  classifyExt,
  TEXT_EXT,
  IMAGE_MIME,
  DOC_MIME,
  DEFAULT_MAX_TEXT_BYTES,
  DEFAULT_MAX_BINARY_BYTES,
};
