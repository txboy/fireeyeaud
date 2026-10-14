/**
 * 搜索「包含 / 排除」范围的本地持久化。
 *
 * 相对路径只有相对某个工作区才有意义，因此按工作区根分别记忆；
 * 仅保留最近使用的若干工作区，避免无限增长。
 */

export interface SearchScope {
  include: string[];
  exclude: string[];
}

const KEY = 'fireeyeaud.searchScope';
const MAX_WORKSPACES = 16;

type ScopeMap = Record<string, SearchScope>;

const EMPTY: SearchScope = { include: [], exclude: [] };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** 内部目录（`.fireeye`）不可作为搜索范围：任意一段命中即剔除。 */
function isProtectedToken(token: string): boolean {
  return token
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => segment === '.fireeye');
}

function sanitize(tokens: string[]): string[] {
  return tokens.filter((token) => !isProtectedToken(token));
}

function normalize(value: unknown): SearchScope {
  const scope = (value ?? {}) as Partial<SearchScope>;
  return {
    include: isStringArray(scope.include) ? sanitize(scope.include) : [],
    exclude: isStringArray(scope.exclude) ? sanitize(scope.exclude) : [],
  };
}

function readAll(): ScopeMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as ScopeMap;
  } catch {
    return {};
  }
}

/** 读取某工作区记忆的搜索范围。 */
export function loadSearchScope(root: string | null): SearchScope {
  if (!root) return { ...EMPTY, include: [], exclude: [] };
  const stored = readAll()[root];
  return stored ? normalize(stored) : { include: [], exclude: [] };
}

/** 写入某工作区的搜索范围（该工作区提到最近使用）。 */
export function saveSearchScope(root: string | null, scope: SearchScope): void {
  if (!root) return;
  try {
    const all = readAll();
    const next: ScopeMap = { [root]: normalize(scope) };
    let count = 0;
    for (const key of Object.keys(all).reverse()) {
      if (key === root) continue;
      if (count >= MAX_WORKSPACES - 1) break;
      next[key] = all[key];
      count += 1;
    }
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 忽略写入失败（隐私模式等） */
  }
}
