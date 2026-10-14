'use strict';

/**
 * 搜索结果「包含 / 排除」范围匹配。
 *
 * token 约定（渲染层选择器产出）：
 * - 以 `/` 结尾 → 目录子树，如 `docs/sub/` 命中 `docs/sub/a.md` 与更深的文件；
 * - 其它 → 精确相对路径，如 `docs/a.md` 只命中它自己。
 *
 * 兼容旧字符串形式（按逗号 / 空白拆分 token），便于过渡与手输。
 */

/** 把 include/exclude 规整成去重的 token 数组。 */
function parseTokens(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '').split(/[,\s]+/);
  const out = [];
  for (const item of raw) {
    const token = String(item ?? '').trim();
    if (token && !out.includes(token)) out.push(token);
  }
  return out;
}

function normalize(rel) {
  return String(rel ?? '').replace(/\\/g, '/');
}

/** 单个 token 是否命中相对路径。 */
function tokenMatches(relPath, token) {
  const t = normalize(token).replace(/^\/+/, '');
  if (!t) return false;
  const rel = normalize(relPath);
  if (t.endsWith('/')) {
    const dir = t.replace(/\/+$/, '');
    if (!dir) return false;
    return rel === dir || rel.startsWith(`${dir}/`);
  }
  return rel === t;
}

/** 命中任一排除 token 即排除。 */
function isExcluded(relPath, tokens) {
  return tokens.some((token) => tokenMatches(relPath, token));
}

/** 无包含 token → 全部通过；否则命中任一 token 才包含。 */
function isIncluded(relPath, tokens) {
  if (tokens.length === 0) return true;
  return tokens.some((token) => tokenMatches(relPath, token));
}

module.exports = { parseTokens, tokenMatches, isExcluded, isIncluded };
