import zhCN from './zh-CN';
import enUS from './en-US';

export const resources = {
  'zh-CN': zhCN,
  'en-US': enUS,
} as const;

export type Locale = keyof typeof resources;

export const supportedLocales: Locale[] = ['zh-CN', 'en-US'];
export const defaultLocale: Locale = 'zh-CN';

/** 全部 i18n 命名空间（与设计文档 §13.2 对齐）。 */
export const namespaces = Object.keys(zhCN);

/** 语言中立的枚举显示 key 前缀（enums.*）。 */
export const enumNamespaces = ['enums'] as const;
