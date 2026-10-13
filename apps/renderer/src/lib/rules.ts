import type { AuditRule } from '@fireeyeaud/shared';

/**
 * 取自定义规则的名称文本。
 * 后端 `name` 为字符串；共享类型同时兼容 `{lang,text}`（内置/多语言）。
 */
export function ruleName(rule: AuditRule): string {
  const n = rule.name;
  if (typeof n === 'string') return n;
  if (n?.text) return n.text;
  return '';
}
