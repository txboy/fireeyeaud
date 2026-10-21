/// <reference types="node" />

/**
 * 把代码块语言标签归一成 SQL 族判断。
 *
 * 只有 SQL 族的代码块才在 SQL 助手里显示「填入编辑器 / 直接运行」，
 * 普通对话不传 sqlActions，行为完全不变。
 */
const SQL_LANGUAGES = new Set([
  'sql',
  'mysql',
  'postgres',
  'postgresql',
  'sqlite',
  'tsql',
  'plsql',
]);

export function isSqlLanguage(lang: string): boolean {
  return SQL_LANGUAGES.has(lang.trim().toLowerCase());
}