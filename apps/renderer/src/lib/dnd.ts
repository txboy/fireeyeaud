/**
 * 拖拽传输类型（文件树 ↔ 聊天输入框等）。
 *
 * - `WORKSPACE_DRAG_PATH`：工作区文件树内部拖拽携带的**绝对路径**（沿用既有约定，
 *   FileTree 的移动/复制 drop 逻辑依赖它）。
 * - `WORKSPACE_DRAG_ENTRY`：同一拖拽额外携带的条目元数据 JSON `{path,name,isDir}`，
 *   供聊天输入框判断是文件还是目录（路径本身无法区分）。
 */
export const WORKSPACE_DRAG_PATH = 'application/x-fireeye-path';
export const WORKSPACE_DRAG_ENTRY = 'application/x-fireeye-entry';
