"""自定义 HTTP 搜索适配器（设计 §10 / 决策）。

约定：`POST {baseUrl}`，Bearer 鉴权，请求体 `{query, max_results}`，
响应 `{results:[{title,url,content,score?}]}`。
"""

from __future__ import annotations

from typing import Any

import httpx

_TIMEOUT = 30.0


def search(
    base_url: str,
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
            base_url,
            headers={"Authorization": f"Bearer {api_key}"},
            json={"query": query, "max_results": max_results},
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
