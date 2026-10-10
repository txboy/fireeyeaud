"""知识库 Provider 适配器注册（设计 §14.19）。"""

from __future__ import annotations

from typing import Any

from ..errors import ApiError
from . import dify, ragflow

_ADAPTERS: dict[str, Any] = {"dify": dify, "ragflow": ragflow}


def adapter_for(provider_type: str) -> Any:
    try:
        return _ADAPTERS[provider_type]
    except KeyError as exc:
        raise ApiError(
            "E_KB_TYPE", 400, "error.kbType", {"type": provider_type}
        ) from exc
