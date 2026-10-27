# 架构总览

## 三个进程

```
┌─────────────────────────────────────────────────────┐
│  Electron 主进程 (apps/desktop/src/main.cjs)         │
│  · 建窗口、管生命周期                                  │
│  · spawn 并守护 Python sidecar                       │
│  · 文件读写 IPC（工作区内的读 / 写 / 删 / 复制 / 移动）  │
│  · safeStorage 加密密钥                              │
└───────────────┬─────────────────────┬───────────────┘
                │ ipcMain/ipcRenderer │ HTTP + SSE
                │ (preload.cjs 白名单) │ 127.0.0.1:<随机端口>
┌───────────────▼─────────────┐ ┌─────▼─────────────────┐
│ 渲染进程 (apps/renderer)     │ │ Python sidecar        │
│ React + Zustand + Ant Design │ │ (services/agent)      │
│ 只管界面与状态                │ │ FastAPI + LangGraph   │
│ 不直接碰文件系统、不持有密钥    │ │ 持有 DuckDB / SQLite   │
└─────────────────────────────┘ └───────────────────────┘
```

**为什么拆成这样**：界面崩溃不影响正在跑的分析；Python 生态（LangGraph、DuckDB、python-docx）是不可替代的；文件系统访问收在主进程一处，渲染进程拿到的能力是白名单。

## 请求怎么走

以「提问」为例，一条消息穿过所有三层：

```
用户在输入框敲下问题
  → renderer/store/chat.ts 组装参数
  → lib/api/chat.ts: streamChat()
  → POST http://127.0.0.1:<port>/api/v1/sessions/{id}/chat
  → api/sessions.py 接收（校验 Bearer token）
  → agent/graph.py 跑 LangGraph 循环
       planning → 调工具（tools/*.py）→ reflecting → 再规划
  → 每个事件立刻以 SSE 推回
  → renderer 逐条收到 status / token / tool_call / tool_result / done
  → chat store 更新消息，界面逐步刷新
```

关键点：

- **SSE 是单向流**。前端不能用它发数据，只能发一次 POST，然后读事件。
- **每个事件都带 `seq`**，前端按序渲染，也是排查“界面卡住”时的依据。
- **工具执行发生在后端**，前端看到的是 `tool_call` / `tool_result` 摘要，不参与执行。

## 目录职责

```
apps/desktop/src/
  main.cjs          应用入口、窗口、所有 ipcMain.handle 注册
  preload.cjs       向渲染进程暴露的白名单 API（contextBridge）
  sidecar.cjs       sidecar 生命周期：找空闲端口、spawn、健康检查、退出回收
  file-preview.cjs  工作区内的读文件（含路径包含校验）
  file-ops.cjs      写 / 删 / 复制 / 移动（含路径包含与保护目录校验）
  secrets.cjs       safeStorage 加解密
  search.cjs        工作区文件遍历与关键词搜索

apps/renderer/src/
  store/            Zustand，每个领域一个 store，是界面状态的唯一来源
  lib/api.ts        ⚠ 只是 re-export 桶，实现在 lib/api/*
  lib/api/client.ts HTTP 内核：ApiError / request / safeFetch
  lib/api/*.ts      按领域拆的接口封装（17 个模块）
  components/       界面组件；panels/ 是左侧活动栏面板，forms/ 是配置表单
  hooks/            跨组件复用的逻辑

services/agent/src/fireeyeaud_agent/
  main.py           FastAPI 装配，把 20 个 router 挂到 /api/v1
  api/              HTTP 层：解析请求、校验、转调 store / agent
  agent/            LangGraph 图、系统提示词、上下文压缩、各类对话
  tools/            Agent 可调用的 12 个内置工具
  store/            持久化层：JSONL 事件流、DuckDB、文件、加密、归档
  config/           全局 / 项目级配置的读写
  kb/ web/ mcp/     外部集成适配器

packages/shared/src/
  types.ts          前后端共享的类型定义（SSE 事件、疑点、证据……）
  locales/          中英文案
```

## 两处容易踩的边界

### 渲染进程不直接读文件

预览、编辑文件走 `window.fireeyeaud.readFile / writeTextFile / ...`（preload 暴露的白名单），由主进程校验路径必须落在工作区内。**不要**在渲染进程里用 `fetch('file://...')` 绕过去。

### `lib/api.ts` 不是实现

它是 re-export 桶，真正的代码在 `lib/api/` 下的 17 个模块里。加接口时改对应领域模块，**不要再往 `api.ts` 里堆函数**——这个文件曾经有 1597 行，拆过一次了。

## 开发环境下的进程关系

`npm run desktop:dev` 会：

1. 起 Vite dev server（渲染进程热更新）
2. 起 Electron 主进程
3. 主进程 spawn sidecar：先 `findFreePort` 拿空闲端口，再以
   `python -m uvicorn fireeyeaud_agent.main:app --host 127.0.0.1 --port <port>` 启动
   （打包后直接执行 PyInstaller 产出的可执行文件）
4. 每 500ms 轮询 `/api/v1/health`，直到 `status === 'ok'`
5. Electron 退出时回收 sidecar 进程树

sidecar 启动期间界面显示「正在启动 Agent 服务」，不会把它当成错误。如果后端要冷启动十几秒，前端会继续在后台探测，不影响你先打开界面。

## 数据放在哪

| 位置 | 内容 | 是否会随工作区拷走 |
|---|---|---|
| `<工作区>/.fireeye/` | 疑点、证据、会话、索引、产物 | 会 |
| `<userData>/secrets.json` | 模型 key、数据库密码等（safeStorage 加密） | 不会 |
| `~/.fireeye/` | 全局作用域配置（全局模型、全局规则等） | 不会 |

详见[数据模型](05-data-model.md)。

## 下一步

- 改后端 → [后端](02-backend.md)
- 改前端 → [前端](03-frontend.md)
- 查接口细节 → [API 与协议](04-api-reference.md)