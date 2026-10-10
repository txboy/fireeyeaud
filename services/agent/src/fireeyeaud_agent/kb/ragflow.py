"""RAGFlow 知识库适配器（设计 §14.19）。

- 列表：`GET {baseUrl}/api/v1/datasets`（Bearer）。
- 检索：`POST {baseUrl}/api/v1/retrieval`。
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
            f"{base_url.rstrip('/')}/api/v1/datasets",
            headers={"Authorization": f"Bearer {api_key}"},
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
    search_method: str | None = None,
    client: httpx.Client | None = None,
) -> list[dict[str, Any]]:
    payload = {
        "question": query,
        "dataset_ids": [knowledge_id],
        "top_k": top_k,
        "similarity_threshold": score_threshold,
        "keyword": True,
    }
    c, owned = _get(client)
    try:
        res = c.post(
            f"{base_url.rstrip('/')}/api/v1/retrieval",
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
        )
        res.raise_for_status()
        data = res.json().get("data") or {}
        chunks = data.get("chunks", [])
    finally:
        if owned:
            c.close()
    return [
        {
            "content": ch.get("content") or "",
            "docId": ch.get("document_id"),
            "docName": ch.get("document_keyword") or "",
            "score": ch.get("similarity"),
        }
        for ch in chunks
    ]
