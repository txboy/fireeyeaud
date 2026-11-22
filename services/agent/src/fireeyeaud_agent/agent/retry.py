"""模型调用的可重试判定与退避。"""

from __future__ import annotations

import random

_RETRY_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}
_RETRY_MARKERS = (
    "rate limit",
    "temporarily unavailable",
    "connection reset",
    "connection aborted",
    "overloaded",
    "server error",
)


def is_retryable(exc: BaseException) -> bool:
    # 本进程的 turn / asyncio 超时不重试，否则总时长会成倍放大。
    if isinstance(exc, TimeoutError):
        return False
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(getattr(exc, "response", None), "status_code", None)
    if status in _RETRY_STATUS:
        return True
    name = type(exc).__name__.lower()
    if "ratelimit" in name or "apiconnection" in name or "apitimeout" in name:
        return True
    if "internalserver" in name:
        return True
    text = str(exc).lower()
    return any(marker in text for marker in _RETRY_MARKERS)


def retry_delay(attempt: int, *, base: float, cap: float = 8.0) -> float:
    """指数退避 + 全抖动，attempt 从 1 开始；结果落在 [0, cap]。"""
    if base <= 0:
        return 0.0
    ceiling = min(cap, base * (2 ** max(0, attempt - 1)))
    return random.uniform(0, ceiling)
