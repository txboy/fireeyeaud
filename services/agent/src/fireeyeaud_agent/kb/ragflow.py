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


def _data(res: httpx.Response) -> Any:
    """解析 RAGFlow 响应体。

    RAGFlow 很多错误以 HTTP 200 + 非 0 的 `code` 返回（例如鉴权、租户、
    参数错误）。若只读 `data`，这些错误会被误当成"空结果"。这里统一把
    非 0 code 抛成异常，交由上层包成 E_KB_CONN 并带出 message。
    """
    body = res.json()
    code = body.get("code", 0)
    if code != 0:
        raise RuntimeError(f"RAGFlow error {code}: {body.get('message') or 'unknown'}")
    return body.get("data")


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
        data = _data(res) or []
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
    top_k: int | None = None,
    score_threshold: float | None = None,
    search_method: str | None = None,
    client: httpx.Client | None = None,
) -> list[dict[str, Any]]:
    # 注意：
    # - 不要发送 `keyword`：keyword=true 会让 RAGFlow 加载租户「默认对话模型」并跑一次
    #   LLM 关键词抽取（见 api/apps/sdk/doc.py::retrieval_test），未授权即报
    #   `Model(...) not authorized`。UI 的检索测试不开此项。
    # - `top_k` / `similarity_threshold` 仅在显式配置时下发；缺省则交给 RAGFlow 服务端
    #   默认（top_k=1024、similarity_threshold=0.2），与 UI 检索测试一致，避免把结果过滤光。
    payload: dict[str, Any] = {
        "question": query,
        "dataset_ids": [knowledge_id],
    }
    if top_k is not None:
        payload["top_k"] = top_k
    if score_threshold is not None:
        payload["similarity_threshold"] = score_threshold
    c, owned = _get(client)
    try:
        res = c.post(
            f"{base_url.rstrip('/')}/api/v1/retrieval",
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
        )
        res.raise_for_status()
        data = _data(res) or {}
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
