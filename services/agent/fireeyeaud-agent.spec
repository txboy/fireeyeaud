# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec：把 sidecar 打为单文件可执行（设计 §8 / §21）。"""

from PyInstaller.utils.hooks import collect_submodules

hiddenimports = (
    collect_submodules("uvicorn")
    + collect_submodules("fireeyeaud_agent")
    + collect_submodules("sqlalchemy.dialects")
    + collect_submodules("sqlglot")
    + collect_submodules("pydantic")
    + collect_submodules("oracledb")
    + collect_submodules("access_parser")
    # 归档（dulwich）：porcelain 子包按需导入，且带 C 扩展；排除 tests 以免打进测试资源。
    + collect_submodules("dulwich", filter=lambda name: ".tests" not in name)
    # MCP 接入（Phase 9）：客户端与传输子模块按需导入，需显式收集。
    # 排除 mcp.cli：它依赖可选 extra（typer），sidecar 用不到。
    + collect_submodules("mcp", filter=lambda name: not name.startswith("mcp.cli"))
)

a = Analysis(
    ["src/fireeyeaud_agent/__main__.py"],
    pathex=["src"],
    hiddenimports=hiddenimports,
    datas=[],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name="fireeyeaud-agent",
    console=False,
)
