# Phase 7 · 文件预览与右侧内容区

- 日期：2026-10-12
- 状态：进行中
- 关联：`docs/design/设计说明.md`、`docs/plans/2026-10-10-phase6-websearch-mcp-packaging.md`

## 1. 目标

资源管理器中点击文件 → 在**右侧区**预览；搜索命中点击文件 → 同样在右侧区预览。
支持文本（可编辑）、图片、Word（.docx）、Excel（.xlsx/.xlsm/.csv）、PDF。
纯本地渲染，不联网、不经 sidecar（文件读写留在 Electron 主进程）。

## 2. 布局重构：「右侧区 = tab 容器」

现状：`活动栏 | 资源管理器 | 对话栏 | 成果栏`（四栏并排）。

目标：`活动栏 | 资源管理器(SideBar) | RightArea`。

`RightArea` 顶部为一排 **tab**，内部是一等 tab 容器：

- **会话 tab（常驻，不可关闭）**：内容 = 对话栏 + 成果栏 一体
  （左对话、右成果；成果栏内部仍保留 `疑点 / 图谱 / 底稿 / 证据` 子 tab）。
- **预览 tab（可多开、可关闭）**：每个文件一个 tab，标题为文件名。

交互：
- 资源管理器点击**文件** → 打开或激活对应预览 tab（替换原「用系统程序打开」的单击行为；点击目录仍为展开/折叠）。
- 搜索命中点击文件 → 打开或激活对应预览 tab。
- 点击历史会话 / 新建会话 → 激活「会话」tab。
- 预览 tab 顶部有 ×；切换、多开均可。

状态集中在 `store/ui.ts`：
```ts
type RightTab =
  | { id: 'session'; kind: 'session' }
  | { id: string; kind: 'preview'; root: string; path: string; name: string };
```
`rightTabs: RightTab[]`、`activeRightTabId: string`；
actions：`openPreview(root, entry)`、`closeRightTab(id)`、`activateRightTab(id)`、`showSession()`。

## 3. 文件读写 IPC（Electron 主进程）

新增可测模块 `apps/desktop/src/file-preview.cjs`，导出 `readFileContent` / `writeTextFile`
（工作区包含校验复用 `path.relative` 逻辑；大小上限；文本写扩展名白名单）。

主进程注册：
- `fs:read-file ({ root, path })`
- `fs:write-text-file ({ root, path, text })`

preload 暴露 `readFile` / `writeTextFile`；`env.d.ts` 与 shared 类型同步。

返回（success）：
- 文本 → `{ ok: true, kind: 'text', text, size, path }`
- 图片 / PDF / docx / xlsx → `{ ok: true, kind: 'base64', data, mime, size, path }`

返回（failure）：`{ ok: false, code: 'E_OUTSIDE_WORKSPACE' | 'E_NOT_FOUND' | 'E_UNSUPPORTED' | 'E_TOO_LARGE' | 'E_READ_FAILED' | 'E_NOT_EDITABLE' | 'E_WRITE_FAILED', ... }`。

## 4. 各格式预览（前端）

| 格式 | 方案 | 依赖 |
|---|---|---|
| 文本 | CodeMirror 6：行号 + 语法高亮 + 可编辑 | `codemirror` + `@codemirror/lang-*` |
| 图片 | `<img src={dataUrl}>`，适应 / 原始缩放 | 无 |
| PDF | `pdfjs-dist` → `<canvas>`，多页 + 缩放 | `pdfjs-dist` |
| Word `.docx` | `docx-preview` → 容器 DOM | `docx-preview` |
| Excel `.xlsx/.xlsm/.csv` | `exceljs` → 逐 sheet 表格 + sheet 切换 | `exceljs` |

- Excel 单元格上限截断（默认 500 行 / 50 列）+ 截断提示。
- 解析失败 → 友好错误态 + 「用系统程序打开」兜底按钮。
- 生产 CSP 小幅放宽：`img-src` 增加 `blob:`；如需显式加 `worker-src 'self'`；不放开 `object-src` / 远程源。

## 5. 文本编辑与保存

- 头部：文件路径 + 脏标记 + 保存按钮；`Ctrl+S` 保存。
- 未保存时切换文件 / 切回会话 / 关闭 tab → `Modal.confirm`「保存 / 不保存 / 取消」。
- 可编辑 = 扩展名在白名单内且未超大小上限；否则只读展示。

## 6. i18n

新增 `preview` 命名空间（zh-CN / en-US）。

## 7. 测试与验收

- `apps/desktop/test/file-preview.test.mjs`（`node --test`）：分类 / 包含校验 / 大小上限 / 写白名单 / 往返读写。
- 渲染层 `tsc --noEmit` + `vite build`。
- 手动 QA：文本（改+存）、图片、PDF、docx、xlsx/csv；tab 多开/关闭/切换。

## 8. 不做（YAGNI）

- 旧版 `.doc` / `.xls`（提示用系统程序打开）。
- Word / Excel / PDF 的编辑（仅预览）。
- 预览 tab 持久化（重启后不恢复）。
