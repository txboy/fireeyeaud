"""Tavily 搜索适配器（设计 §10 / 决策：默认关闭）。"""

from __future__ import annotations

from typing import Any

import httpx

_ENDPOINT = "https://api.tavily.com/search"
_TIMEOUT = 30.0


def search(
    api_key: str,
    query: str,
    *,
    max_results: int = 5,
    client: httpx.Client | None = None,
) -> list[dict[str, Any]]:
    owned = client is None
    c = client or httpx.Client(timeout=_TIMEOUT)
    try:
        res = c.post(
            _ENDPOINT,
            json={"api_key": api_key, "query": query, "max_results": max_results},
        )
        res.raise_for_status()
        data = res.json().get("results", [])
    finally:
        if owned:
            c.close()
    return [
        {
            "title": r.get("title"),
            "url": r.get("url"),
            "content": r.get("content"),
            "score": r.get("score"),
        }
        for r in data
    ]
