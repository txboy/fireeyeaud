/**
 * 后端 HTTP 客户端的统一出口。
 *
 * 实现按领域拆在 `lib/api/*` 下；这里只做 re-export，调用方仍然
 * `import { ... } from '../lib/api'`，签名与原单文件版本完全一致。
 *
 * 新增接口时：找到对应的领域模块追加，不要再把业务堆回这个文件。
 */

export { ApiError, request } from './api/client';

export * from './api/workspaces';
export * from './api/sessions';
export * from './api/chat';
export * from './api/datasources';
export * from './api/findings';
export * from './api/rules';
export * from './api/models';
export * from './api/db';
export * from './api/dbSql';
export * from './api/knowledge';
export * from './api/mcp';
export * from './api/skills';
export * from './api/templates';
export * from './api/evidenceForms';
export * from './api/reports';
export * from './api/archive';
export * from './api/misc';