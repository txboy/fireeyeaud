# 前端（Renderer）

`apps/renderer/` 是 React + TypeScript + Zustand + Ant Design 的界面层，跑在 Electron 渲染进程里。

## 状态管理：Zustand

每个领域一个 store，放在 `src/store/`：

| store | 管什么 |
|---|---|
| `workspace.ts` | 当前工作区路径、最近打开列表、打开/关闭流程 |
| `chat.ts` | 会话列表、消息流、SSE 事件消费 |
| `ui.ts` | 活动栏视图、右侧 tab、选中项——**界面布局的唯一来源** |
| `settings.ts` | 主题、语言、联网检索等设置 |
| `sidecar.ts` | 后端进程状态（port / token / status） |
| `findings.ts` `reports.ts` `forms.ts` … | 各业务领域的数据与操作 |

**约定**：

- store 里**不写 JSX**，只放数据与动作。
- 异步动作失败时把错误落成 `errorKey`（字符串），由组件负责翻译显示：

```ts
catch (err) {
  set({ errorKey: errorKeyOf(err) });
}
```

- `errorKeyOf` 来自 `lib/errorKey.ts`。它只读 `err.messageKey`，不依赖 `api.ts`——**保持这个性质**，否则 node 单测会因为连带加载 sidecar 依赖而整片失败。
- 需要场景化兜底时传第二个参数：`errorKeyOf(err, 'error.deleteFailed')`。

## 右侧区域：tab 模型

界面右侧是一个 tab 容器，所有"打开某个东西"都表达为一个 tab。类型定义在 `store/ui.ts`：

```ts
export type RightTab =
  | SessionTab      // 会话（常驻，只有这一个 kind 的 id 是 'session'）
  | PreviewTab      // 文件预览，每个文件一个
  | FormTab         // 配置表单，form:<域>:<id|new>
  | SettingsTab     // 设置
  | RuleRunTab      // 规则试跑
  | DbSchemaTab     // 数据库表结构
  | DbDataTab       // 数据库表数据
  | KbBrowseTab     // 知识库浏览
  | KbQueryTab      // 知识库试检索
  | ReportTab       // 报告写作台
  | EvidenceFormTab // 取证单写作台
  | ArchiveDiffTab  // 归档差异（单例）
  | ArchiveChangesTab
  | ArchiveRemoteTab
```

加一种新 tab 需要改三处：

1. `store/ui.ts` 的 `RightTab` 联合类型
2. `store/ui.ts` 里加一个 `openXxx()` 动作（参考 `openReport`）
3. `components/RightArea.tsx` 的渲染分支

**离开守卫**：tab 里有未保存内容时，切换/关闭前会调 `allowLeave()` 弹「保存 / 不保存 / 取消」。新 tab 若要参与守卫，需注册到同一套机制（见 `components/forms/UnsavedGuard.tsx`）。

## HTTP 调用

`lib/api.ts` **只是 re-export 桶**，实现在 `lib/api/` 下：

```
lib/api/
  client.ts    ApiError / request / safeFetch / toApiError / 地址与鉴权头
  sse.ts       consumeSseGeneric
  chat.ts      streamChat + 会话共享的上下文类型
  sessions.ts  findings.ts  reports.ts  db.ts  ...  （17 个领域模块）
```

加接口时改对应领域模块的 `xxx.ts`，**不要往 `api.ts` 里加函数**。

SSE 用法：

```ts
await streamChat(sessionId, message, {
  onEvent: (event) => { /* event.type: status | context | token | tool_call | tool_result | done | error */ },
  signal,
});
```

## 用主进程能力

渲染进程不能直接碰文件系统。能力经 `preload.cjs` 白名单暴露为 `window.fireeyeaud`：

| 方法 | 说明 |
|---|---|
| `openFolder()` / `openFiles(kind)` | 系统选择框 |
| `readDir({ root, path })` | 列目录 |
| `readFile({ root, path })` | 读文件（主进程校验路径在工作区内） |
| `writeTextFile({ root, path, text })` | 写文本（扩展名白名单 + 大小上限） |
| `deletePath` `copyFiles` `movePath` `createDir` `createFile` `renamePath` | 文件操作 |
| `putSecret(plaintext)` / `deleteSecret(ref)` | safeStorage 加密存取 |
| `openPath` / `showItemInFolder` / `openExternal` | 交给系统 |
| `onWorkspaceFsChanged(cb)` | 工作区文件变化通知 |
| `onSidecarStatus(cb)` | 后端状态变化 |

调用时**永远用可选链**（`window.fireeyeaud?.readFile?.(...)`）——浏览器里跑预览或单测时这个对象不存在。

新增一个 IPC 能力时要同时改三处：`main.cjs` 的 `ipcMain.handle`、`preload.cjs` 的白名单、以及渲染层调用点。

## 组件组织

```
components/
  workspace/   工作区外壳（WorkspaceShell / WorkspaceChat / WorkspacePreview）
  panels/      左侧活动栏面板（Explorer / Search / Database / Knowledge / ...）
  forms/       配置表单（DatabaseForm / ModelForm / RuleForm / ...）
  reports/     报告写作台
  archive/     归档相关（Panel / DiffTab / ChangesTab / RemoteTab）
  preview/     各类文件预览（Text / Spreadsheet / Pdf / Image / Docx / Csv）
  results/     疑点列表与详情
```

文件名用大驼峰，一个文件一个主要组件。重依赖（CodeMirror、pdfjs、exceljs、docx-preview、Cytoscape）**动态 import**，不要进主 bundle。

## 国际化

文案在 `packages/shared/src/locales/`，按命名空间分组（`navigation` / `error` / `welcome` / `working-paper` …）。

```tsx
const { t } = useTranslation('error');
t('notFound')
```

- **中英两套都要加**，否则另一个语言下会显示原始 key。
- 错误文案统一用 `error` 命名空间，key 与后端 `message_key` 对应（去掉 `error.` 前缀）。

## 样式

- 全局样式在 `src/styles/`，用 CSS 变量承接主题（`--fg` / `--bg` / `--border` 等）。
- 组件内类名用 BEM 风格：`activitybar__item`、`activitybar__item--active`。
- 亮/暗主题切换只改 CSS 变量，**不要在组件里写死颜色**。

## 测试

```bash
cd apps/renderer
node --experimental-transform-types --test tests/*.test.ts
```

注意：node 按原样加载 TS，**无法解析无扩展名的相对导入**。因此被测试间接加载的文件，其依赖要么没有运行时依赖，要么写成带 `.ts` 后缀（参考 `store/reportWorkspace.ts`）。

## 改前端的自查清单

- [ ] 新 store 动作失败时有 `errorKey`
- [ ] 新增 UI 文案中英两套都加了
- [ ] 新 tab 已加进 `RightTab` 联合类型与 `RightArea` 分支
- [ ] IPC 调用用了可选链
- [ ] 重依赖用了动态 import
- [ ] `npx tsc --noEmit` 与 `node --test tests/*.test.ts` 都过