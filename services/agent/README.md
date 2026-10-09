# fireeyeaud-agent

火眼审计助手的 Agent sidecar：FastAPI + LangGraph，仅绑定 `127.0.0.1`。

## 开发

```bash
uv sync              # 创建 .venv 并安装依赖（含 dev）
uv run pytest        # 运行测试
uv run uvicorn fireeyeaud_agent.main:app --host 127.0.0.1 --port 8765 --reload
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `FIREYEAUD_TOKEN` | 空 | 为空时不校验鉴权（dev）；设置后需 `Authorization: Bearer <token>` |
| `FIREYEAUD_HOST` | `127.0.0.1` | 绑定地址 |
| `FIREYEAUD_PORT` | `8765` | 端口 |
| `FIREYEAUD_APP_VERSION` | `0.0.0` | 应用版本（`/health` 返回） |
| `FIREYEAUD_SCHEMA_VERSION` | `1` | 数据格式版本 |

## 路由（前缀 `/api/v1`）

- `GET /health`
- `POST /sessions`
- `POST /sessions/{id}/chat`（SSE，事件信封见设计文档 §14.7）
