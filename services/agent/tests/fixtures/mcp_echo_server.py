"""测试用最小 MCP stdio 服务器（echo 工具）。由 test_mcp_client 以子进程启动。"""

from __future__ import annotations

import asyncio

from mcp.server.mcpserver import MCPServer

server = MCPServer("echo")


@server.tool(description="回显文本")
def echo(text: str) -> str:
    return "echo:" + text


if __name__ == "__main__":
    asyncio.run(server.run_stdio_async())
