# 火眼审计助手 (fireeyeaud)

纯本地客户端的财务 / 会计审计助手。以 VS Code 式「打开文件夹」工作区为入口，
对工作区内的报表 / 凭证等文件进行 AI 辅助审计，产出疑点清单、证据图谱与审计工作底稿。

- **产品定位**：一个安装包双击即用；默认不联网；产物落盘在工作区 `.fireeye/`。
- **目标平台**：Windows 优先，其后 macOS / Linux。

## 架构

- **Electron 壳**：spawn / 守护 Python sidecar（随机空闲端口 + 健康检查）。
- **渲染进程**：Vite + React + TypeScript + Ant Design + Zustand。
- **Agent 服务**：FastAPI + LangGraph（仅绑 `127.0.0.1`），PyInstaller 打包为 sidecar。
- **数据**：DuckDB（分析）+ SQLite（状态 / checkpointer）。

## 目录结构

```
fireeyeaud/
├─ apps/                 # desktop（Electron 主进程）/ renderer（前端）
├─ services/agent/       # FastAPI + LangGraph sidecar（uv 管理）
├─ packages/shared/      # 前后端共享 TS 类型 + 多语言资源
└─ docs/                 # 设计文档与设计稿
```

## 开发

前置：Node ≥ 20、`uv`、Python 3.12（由 uv 自动获取）。

```bash
# 1) 安装依赖
npm install                       # JS 工作区（含 Electron）
cd services/agent && uv sync      # Agent sidecar（.venv + 依赖）

# 2) 从仓库根运行
npm run agent:test                # sidecar 冒烟测试（pytest）
npm run agent:dev                 # 单独启动 sidecar（固定 8765，热重载）
npm run desktop:dev               # 启动 Electron（自动 spawn sidecar：随机端口 + 健康检查 + 退出回收）
npm run desktop:test              # Electron 壳的 sidecar 生命周期测试（node --test）
```

> 若 Electron 二进制下载缓慢 / 失败（GitHub Releases 受限），使用国内镜像：
> `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npx electron --version`

## 文档

- 设计文档：[`docs/plans/fireeyeaud-design.md`](docs/plans/fireeyeaud-design.md)
- UI 设计说明：[`docs/design/设计说明.md`](docs/design/设计说明.md)
