"""通用小工具。"""

from __future__ import annotations

from datetime import datetime, timezone


def now_iso() -> str:
    """当前时间的 ISO 8601 字符串（带本地时区偏移）。"""
    return datetime.now(timezone.utc).astimezone().isoformat()
