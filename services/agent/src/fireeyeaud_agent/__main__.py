"""PyInstaller 入口：以环境变量端口启动 uvicorn（打包后的 sidecar）。"""

from __future__ import annotations

import os
import sys

from fireeyeaud_agent.main import app


def _resolve(argv: list[str] | None) -> tuple[str, int]:
    """端口来源优先级：命令行 `--port` > 环境变量 `FIREYEAUD_PORT` > 默认 8765。"""
    host = os.environ.get("FIREYEAUD_HOST", "127.0.0.1")
    port = os.environ.get("FIREYEAUD_PORT", "8765")
    args = list(sys.argv[1:] if argv is None else argv)
    for flag in ("--host", "--port"):
        if flag not in args:
            continue
        idx = args.index(flag)
        if idx + 1 >= len(args):
            continue
        if flag == "--host":
            host = args[idx + 1]
        else:
            port = args[idx + 1]
    return host, int(port)


def main() -> None:
    host, port = _resolve(None)
    import uvicorn  # 惰性导入：args 解析与测试不拉起整个 web 栈

    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
