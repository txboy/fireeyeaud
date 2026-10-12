# Phase 7b · 配置表单在右侧 tab 中打开（含编辑）

- 日期：2026-10-12
- 状态：已完成

## 目标

把 **数据库 / MCP / Skills / Models** 四个配置面板的「新增 / 编辑」表单，从左侧栏内联
改为在**右侧内容区**以 tab 打开；并为 MCP / Skills / 数据库连接补上「编辑」能力
（模型已有）。

## 交互约定

- 右侧 tab 容器扩展出第三种 tab：`{ kind: 'form', domain, mode, entityId?, scope?, name? }`。
- **每个实体一个 tab**：`id = form:<domain>:<entityId | new>`，可多开、可关闭。
- 点击面板「新增」→ 打开该域的 `create` tab；点击某行「编辑」→ 打开该实体的 `edit` tab
  （已打开则激活）。
- 保存成功后关闭该 tab；取消关闭该 tab。
- 表单有未保存修改时，切换 / 关闭 / 回会话前弹「保存 / 不保存 / 取消」确认
  （复用 Phase 7 的右侧区离开守卫）。

## 后端（Agent sidecar）

- `api/db.py`：新增 `PATCH /db/connections/{id}?scope=...`（`ConnectionPatch`）。
- `store/db.py`：新增 `update_connection(...)`，校验 driver、处理 `credRef`。
- `config/store.py`：`update_item` 增加关键字参数 `drop_none=True`；数据库更新用
  `drop_none=False`，以便显式清空字段（如换驱动时清掉 host/port）。
- 测试：`tests/test_db_api.py` 补 PATCH 用例。

## 前端（renderer）

- `lib/api.ts`：新增 `updateDbConnection`。
- `store/{mcp,skills,database}.ts`：新增 `edit(...)`（含 errorKey 处理）。
- `store/ui.ts`：`RightTab` 增加 `FormTab`；新增 `openForm(domain, mode, entity?)`；
  离开守卫由 `setPreviewLeaveGuard` 泛化为 `setLeaveGuard`（预览与表单共用）。
- 新增 `components/forms/{ModelForm,McpForm,SkillForm,DatabaseForm}.tsx`：各自管理表单
  状态与提交，props 统一 `{ entity?, onSaved, onCancel, onDirtyChange }`。
- 新增 `components/FormTabView.tsx`：按 domain 路由到对应表单 + 头部标题 + 离开守卫。
- `components/RightArea.tsx`：渲染 `form` tab（图标按域）。
- 四个面板：移除内联表单状态/JSX，改为「新增 / 编辑」按钮调用 `openForm`；
  MCP / Skills / 数据库卡片增加「编辑」按钮。
- i18n：补 `mcp.editServer` / `skills.editSkill` / `database.editConnection`。
- CSS：`.formtab` 等样式。

## 不做 / 已知限制

- 表单 tab 不持久化（关闭即丢弃）。
- 数据库「编辑」不允许改 scope（与既有 PATCH 语义一致，scope 走查询参数）。
- 授权（表/字段）仍在数据库面板内联，不进表单 tab。
