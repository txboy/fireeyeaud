"""PyInstaller 入口：以环境变量端口启动 uvicorn（打包后的 sidecar）。"""

from __future__ import annotations

import os

import uvicorn

from fireeyeaud_agent.main import app


def main() -> None:
    port = int(os.environ.get("FIREYEAUD_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
