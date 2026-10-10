"""联网搜索 Provider 适配器注册（设计 §10）。"""

from __future__ import annotations

from typing import Any

from ..errors import ApiError
from . import custom, tavily

_ADAPTERS: dict[str, Any] = {"tavily": tavily, "custom": custom}


def adapter_for(provider: str) -> Any:
    try:
        return _ADAPTERS[provider]
    except KeyError as exc:
        raise ApiError(
            "E_WEB_PROVIDER", 400, "error.webProvider", {"provider": provider}
        ) from exc
