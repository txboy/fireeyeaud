import type { ConfigScope, TemplateInfo, TemplateKind } from '@fireeyeaud/shared';

/**
 * 解析默认模板，顺序必须与后端 `store/templates.default_template` 一致：
 * 项目默认 → 全局默认 → 项目首条 → 全局首条 → 内置示例。
 *
 * 只用于「打开表单时预选」；实际读写始终带着显式的 `templateId + templateScope`。
 */
export function pickDefaultTemplate(
  items: TemplateInfo[],
  kind: TemplateKind,
): TemplateInfo | null {
  const scoped = (scope: ConfigScope) =>
    items.filter((i) => i.kind === kind && i.scope === scope && !i.builtin);

  return (
    scoped('project').find((i) => i.isDefault) ??
    scoped('global').find((i) => i.isDefault) ??
    scoped('project')[0] ??
    scoped('global')[0] ??
    items.find((i) => i.kind === kind && i.builtin) ??
    null
  );
}