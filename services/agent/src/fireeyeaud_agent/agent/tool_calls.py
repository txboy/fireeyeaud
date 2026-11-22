"""工具调用共享契约：稳定的 call id 与结构化错误载荷。"""

from __future__ import annotations

from typing import Any


def call_id(call: dict[str, Any], *, step: int, index: int) -> str:
    """优先用 provider 的 id；缺失时用 step + index，避免同一步内冲突。"""
    raw = str(call.get("id") or "").strip()
    return raw or f"call_{step}_{index}"


def tool_error_payload(exc: BaseException, *, tool: str) -> dict[str, Any]:
    """把异常转成模型可消费、前端可展示的结构化错误。"""
    from ..errors import ApiError

    if isinstance(exc, ApiError):
        return {
            "ok": False,
            "tool": tool,
            "error": exc.envelope["error"],
            "retryable": False,
        }
    return {
        "ok": False,
        "tool": tool,
        "error": {
            "code": "E_TOOL_FAILED",
            "messageKey": "error.toolFailed",
            "params": {"tool": tool, "reason": str(exc)[:500]},
        },
        "retryable": False,
    }
