"""对话代理包。

`graph` 会拉起整套 LLM 栈（langchain_openai → openai → 数百个模块），首次导入约 1.3 秒。
sidecar 启动时只需要 FastAPI，因此这里**惰性导出**：真正发起对话时才加载 `graph`。
（启动耗时见 docs/plans/2026-10-27-startup-performance.md）
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - 仅类型检查用
    from .graph import stream_chat

__all__ = ["stream_chat"]


def __getattr__(name: str) -> Any:
    if name == "stream_chat":
        from .graph import stream_chat

        globals()["stream_chat"] = stream_chat
        return stream_chat
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")