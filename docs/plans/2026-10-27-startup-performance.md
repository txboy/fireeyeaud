# 启动与打开项目性能问题（2026-10-27）

## 现象

启动软件后点「最近打开的项目」，欢迎页项目列表下方出现红字「发生内部错误」（`error.internal`），
要等超过一分钟、再点一次才进得去。

## 根因（按重要性排序）

1. **后端启动慢**：`fireeyeaud_agent.main` 顶层导入链把整套 LLM 栈（`langchain_openai` →
   `openai` → 数百个模块）都拉起来了。实测：
   - `import fireeyeaud_agent.main`：**2.05s**
   - 去掉 LLM 栈后：**1.24s**（本机；在 Electron/Chromium 抢磁盘 + 杀毒扫描时，
     同样的导入会被放大到 **22~35 秒**，见 `%APPDATA%/fireeyeaud/logs/agent-*.log` 中
     `spawn → Uvicorn running` 的时间差）
2. **前端只等 15 秒就放弃**：`sidecar.cjs` 健康检查 60 次 × 500ms，超时标记 `failed`
   且不重试；前端 `fetch` 连接被拒 → `E_NETWORK` 被映射成 `error.internal` → 「发生内部错误」。
3. **没有任何自动重试**：后端其实 1~2 秒后就绪了，但欢迎页不会自己再试，只能手动点第二次。
4. **打开项目后同步是同步等待的**：每次打开都 `sync?full=true`（全量重导 + 每个文件算 sha256），
   大项目要跑很久，且没有「准备中」的明确提示。

## 改动

### 后端：LLM 栈惰性加载（治本）

- `agent/__init__.py`：`stream_chat` 改为模块级 `__getattr__` 惰性导出。
- `agent/graph.py`、`agent/report_agent.py`、`agent/form_agent.py`：`config.models` 的导入移到
  真正发起对话的函数里。
- `api/sessions.py`、`api/reports.py`、`api/evidence_forms.py`、`api/db.py`：代理模块的导入移到
  各自 `chat` 路由函数体内。
- 防回退：`tests/test_lazy_imports.py` 在子进程里断言「导入应用不会拉起 openai / langchain_openai」。

### 后端：增量对账

- `store/importer.py`：指纹新增 `mtimeNs`（源文件 mtime，纳秒）。旧的 `mtime` 仍是导入时刻，兼容旧索引。
- `store/sync.py`：`size + mtimeNs` 都未变时**不再读盘算 sha256**；旧索引（没有 `mtimeNs`）自动回退到
  算 sha256，不会被误判成「未变化」。

### 桌面端：不再把「慢启动」当成失败

- `sidecar.cjs`：健康检查上限 15s → **120s**；前 5 秒同步等待，超时后转**后台探测**，就绪即自动
  切 `running` 并广播；stop / 进程退出时清理探测定时器。
- stdout/stderr 改用 `StringDecoder` 增量解码并按行拼接：修掉多字节汉字被分包后写进日志变乱码的问题。

### 渲染层：打开项目不阻塞 + 明确提示

- `store/workspace.ts`：后端未就绪（`E_NETWORK` / `E_SIDECAR_NOT_READY`）时自动重试，最多约 2 分钟；
  同一路径重复点击不叠加；新增 `errorKey` 供欢迎页区分「启动中」与「真失败」。
- `store/datasources.ts`：对账改为串行队列——进行中再来的请求**合并成一次补跑**（不丢、不并发，
  后端对账持有全局锁）；新增 `backgroundSync`（后台准备）与前台 `syncing` 区分。
- `components/WorkspaceWatcher.tsx`：打开项目后走**后台增量**对账，不再 `full` 全量重导。
- `components/Welcome.tsx`：后端启动中显示「Agent 服务正在启动」，失败时显示原因 + 「重试」按钮。
- `components/panels/ExplorerPanel.tsx` / `StatusBar.tsx`：后台准备时显示进度提示。
- `components/panels/DatabasePanel.tsx` / `DbSchemaView.tsx`：准备中提示「表结构稍后可用」，
  并暂不允许打开授权页，避免误判为「表不存在」。
- `components/workspace/WorkspaceShell.tsx`：文档 store 的 `errorKey` 是全局共享的，改为只展示
  本次加载真实的失败，避免把无关错误显示成「发生内部错误」。

### 文案

- `error.network`（连不上本地 Agent，已自动重试）、`error.sidecarStarting`、
  `common.sidecarStarting`、`explorer.preparingData`、`database.dataPreparing`、
  `search.failed`、`agent.toolFailed`：不再一律落到「发生内部错误」。

## 验证

| 项目 | 结果 |
|---|---|
| `import fireeyeaud_agent.main` | 2.05s → **1.24s**，且不再加载 `openai` / `langchain_openai` |
| sidecar 冷启动到 `/health` 就绪（uvicorn 真实拉起） | **1.40s** |
| 后端测试 | 全绿（含新增 `test_lazy_imports.py`、`test_sync.py` 增量用例） |
| 渲染层测试 | 99 pass（含新增 `datasourcesSyncQueue.test.ts`） |
| 桌面端测试 | 64 pass（含新增「启动慢不判死」「中文管道解码」） |
| `tsc --noEmit` + `vite build` | 通过 |

## 仍需注意

- 若以后又出现「启动 30 秒」，先看日志里 `spawn → Uvicorn running` 的时间差：现在正常应在 2~5 秒内，
  超出说明又有重依赖被加到 `main` 的顶层导入链上（`test_lazy_imports.py` 能兜住 LLM 栈这一类）。
- 增量对账依赖 mtime 精度：极少数文件系统 mtime 粒度为 2 秒时，同一秒内的「大小不变」改动会漏检；
  此时可用资源管理器的「重新导入」（full）强制刷新。