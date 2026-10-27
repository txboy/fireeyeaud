"""启动性能：LLM 栈必须惰性加载。

`langchain_openai` + `openai` 首次导入约 1.3 秒（几百个模块）；sidecar 启动时只需要
FastAPI。这里用子进程验证「导入应用」不会拉起 LLM 栈，「发起对话」时才拉起。
"""

from __future__ import annotations

import subprocess
import sys

LAZY_CHECK = """
import sys
import fireeyeaud_agent.main

heavy = sorted(
    name
    for name in sys.modules
    if name.split(".")[0] in {"openai", "langchain_openai"}
)
print(",".join(heavy))
"""

AGENT_EXPORT_CHECK = """
from fireeyeaud_agent.agent import stream_chat

print(stream_chat.__module__)
"""


def _run(code: str) -> str:
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def test_app_import_does_not_pull_llm_stack() -> None:
    assert _run(LAZY_CHECK) == ""


def test_agent_package_still_exports_stream_chat() -> None:
    assert _run(AGENT_EXPORT_CHECK) == "fireeyeaud_agent.agent.graph"