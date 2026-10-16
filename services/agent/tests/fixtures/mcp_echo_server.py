"""测试用最小 MCP stdio 服务器（echo 工具）。由 test_mcp_client 以子进程启动。"""

from __future__ import annotations

import asyncio
import os

from mcp.server.mcpserver import MCPServer

server = MCPServer("echo")


@server.tool(description="回显文本")
def echo(text: str) -> str:
    return "echo:" + text


@server.tool(description="读取子进程环境变量")
def show_env(name: str) -> str:
    return os.environ.get(name, "")


@server.tool(description="睡眠指定秒数（用于超时测试）")
def sleep_seconds(seconds: float) -> str:
    import time

    time.sleep(seconds)
    return "ok"


if __name__ == "__main__":
    asyncio.run(server.run_stdio_async())
