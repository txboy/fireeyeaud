"""Dify 知识库适配器（设计 §14.19）。

- 列表：`GET {baseUrl}/datasets`（Bearer）。
- 检索：`POST {baseUrl}/datasets/{id}/retrieve`。
- `query` 上限 250 字符，超长截断。
"""

from __future__ import annotations

from typing import Any

import httpx

_TIMEOUT = 30.0


def _get(client: httpx.Client | None) -> tuple[httpx.Client, bool]:
    if client is not None:
        return client, False
    return httpx.Client(timeout=_TIMEOUT), True


def list_knowledge(
    base_url: str, api_key: str, *, client: httpx.Client | None = None
) -> list[dict[str, Any]]:
    c, owned = _get(client)
    try:
        res = c.get(
            f"{base_url.rstrip('/')}/datasets",
            headers={"Authorization": f"Bearer {api_key}"},
            params={"page": 1, "limit": 100},
        )
        res.raise_for_status()
        data = res.json().get("data", [])
    finally:
        if owned:
            c.close()
    return [
        {
            "id": d.get("id"),
            "name": d.get("name"),
            "documentCount": d.get("document_count"),
        }
        for d in data
    ]


def retrieve(
    base_url: str,
    api_key: str,
    knowledge_id: str,
    query: str,
    *,
    top_k: int = 5,
    score_threshold: float = 0.3,
    search_method: str = "hybrid_search",
    client: httpx.Client | None = None,
) -> list[dict[str, Any]]:
    payload = {
        "query": query[:250],
        "retrieval_model": {
            "search_method": search_method,
            "top_k": top_k,
            "score_threshold_enabled": True,
            "score_threshold": score_threshold,
        },
    }
    c, owned = _get(client)
    try:
        res = c.post(
            f"{base_url.rstrip('/')}/datasets/{knowledge_id}/retrieve",
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
        )
        res.raise_for_status()
        records = res.json().get("records", [])
    finally:
        if owned:
            c.close()
    chunks: list[dict[str, Any]] = []
    for r in records:
        seg = r.get("segment") or {}
        doc = seg.get("document") or (r.get("document") or {})
        chunks.append(
            {
                "content": seg.get("content") or r.get("content") or "",
                "docId": r.get("document_id") or seg.get("document_id"),
                "docName": doc.get("name") or "",
                "score": r.get("score"),
            }
        )
    return chunks
