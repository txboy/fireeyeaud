import type { DbDriver } from '@fireeyeaud/shared';

/**
 * 数据库文件扩展名 → 驱动（与 desktop 文件选择框 `dialog:open-files` 保持一致）。
 * `.db` 等 SQLite 扩展名按 SQLite 处理。
 */
const DB_EXT: Record<string, DbDriver> = {
  db: 'sqlite',
  sqlite: 'sqlite',
  sqlite3: 'sqlite',
  db3: 'sqlite',
  s3db: 'sqlite',
  sl3: 'sqlite',
  mdb: 'access',
  accdb: 'access',
};

/** 由文件名取数据库驱动；非数据库文件返回 null。 */
export function dbDriverFor(name: string): DbDriver | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  return DB_EXT[name.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * 归一化文件路径用于比较：统一分隔符、去掉结尾分隔符、忽略大小写。
 * 仅用于 Windows 桌面端的「同一文件」判断。
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}
