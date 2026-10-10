"""web_search：联网检索（默认关闭；设计 §10 / §17.1）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..errors import ApiError

DEFAULT_MAX = 5


def web_search(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    from ..store import app_settings, secrets
    from ..web import adapter_for

    cfg = app_settings.load().get("webSearch") or {}
    if not cfg.get("enabled"):
        raise ApiError("E_WEB_DISABLED", 403, "error.webDisabled")
    provider = cfg.get("provider") or "tavily"
    api_key = secrets.get(cfg.get("keyRef") or "") or ""
    query = str(params.get("query") or "")
    try:
        max_results = int(params.get("maxResults") or DEFAULT_MAX)
    except (TypeError, ValueError):
        max_results = DEFAULT_MAX
    adapter = adapter_for(provider)
    try:
        if provider == "custom":
            results = adapter.search(
                cfg.get("baseUrl") or "", api_key, query, max_results=max_results
            )
        else:
            results = adapter.search(api_key, query, max_results=max_results)
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ApiError(
            "E_WEB_CONN", 502, "error.webConn", {"reason": str(exc)}
        ) from exc
    return {"results": results, "provider": provider}
