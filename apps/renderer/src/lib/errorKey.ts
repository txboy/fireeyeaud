/**
 * 错误 → 本地化文案 key。
 *
 * 后端统一返回 `ApiError.messageKey`；非 ApiError（第三方库、运行时异常）没有 key，
 * 退回到 `fallback`（默认「发生内部错误」）。这段逻辑原先在 36 个文件里各写了一遍，
 * 统一到此处，避免规则改动时漏改。
 *
 * 本模块**刻意不依赖任何运行时值**（不 import api.ts）：
 * `node --experimental-transform-types` 的单测按原样加载 TS，无法解析无扩展名的相对导入，
 * 一旦依赖 api.ts，所有间接 import 它的 store 都会在单测里加载失败。
 */

/** 错误 → 本地化文案 key（`error.xxx`）。 */
export type ErrorKey = string;

/**
 * 从任意异常 / 事件数据里取本地化文案 key。
 *
 * 只做「形状判断」：任何带非空 `messageKey` 的对象都认（ApiError、SSE 事件 data 等）。
 */
export function errorKeyOf(err: unknown, fallback: ErrorKey = 'error.internal'): ErrorKey {
  const key = (err as { messageKey?: unknown } | null | undefined)?.messageKey;
  return typeof key === 'string' && key ? key : fallback;
}

/** 同上，但去掉 `error.` 前缀：`useTranslation('error')` 里的 t() 只认短键。 */
export function errorTextOf(
  err: unknown,
  fallback: ErrorKey = 'error.internal',
): string {
  return errorKeyOf(err, fallback).replace(/^error\./, '');
}