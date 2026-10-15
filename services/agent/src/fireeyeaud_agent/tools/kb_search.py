"""kb_search：检索已启用的知识库并归一化命中片段（设计 §14.19 / §10.1）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..errors import ApiError

DEFAULT_TOPK = 5


def kb_search(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    from .. import kb
    from ..store import knowledge

    root = Path(root)
    query = str(params.get("query") or "")
    kb_ids = params.get("kbIds")

    enabled = [e for e in knowledge.list_enabled_effective(root) if e.get("enabled")]
    if kb_ids:
        wanted = {str(i) for i in kb_ids}
        enabled = [e for e in enabled if str(e.get("knowledgeId")) in wanted]

    # 会话上下文：仅允许默认 ∪ 勾选的 Provider（None 表示不限制）。
    allowed = params.get("allowedProviderIds")
    if allowed is not None:
        allowed_set = {str(i) for i in allowed}
        enabled = [e for e in enabled if str(e.get("providerId")) in allowed_set]

    providers = {p["id"]: p for p in knowledge.list_providers(root)}
    groups: dict[str, list[dict[str, Any]]] = {}
    for entry in enabled:
        groups.setdefault(str(entry.get("providerId")), []).append(entry)

    chunks: list[dict[str, Any]] = []
    for provider_id, entries in groups.items():
        provider = providers.get(provider_id)
        if provider is None:
            continue
        adapter = kb.adapter_for(provider["type"])
        key = knowledge.get_secret(provider.get("apiKeyRef") or provider_id) or ""
        defaults = provider.get("defaults") or {}
        top_k = params.get("topK") or defaults.get("topK")
        threshold = params.get("scoreThreshold")
        if threshold is None:
            threshold = defaults.get("scoreThreshold")
        for entry in entries:
            try:
                hits = adapter.retrieve(
                    provider["baseUrl"],
                    key,
                    str(entry.get("knowledgeId")),
                    query,
                    top_k=top_k,
                    score_threshold=threshold,
                    search_method=defaults.get("searchMethod", "hybrid_search"),
                )
            except Exception as exc:  # noqa: BLE001
                raise ApiError(
                    "E_KB_CONN", 502, "error.kbConn", {"reason": str(exc)}
                ) from exc
            for h in hits:
                chunks.append(
                    {
                        "provider": provider["type"],
                        "providerId": provider_id,
                        "knowledgeId": entry.get("knowledgeId"),
                        "knowledgeName": entry.get("name"),
                        "docId": h.get("docId"),
                        "docName": h.get("docName"),
                        "content": h.get("content"),
                        "score": h.get("score"),
                        "url": h.get("url"),
                        "metadata": h.get("metadata"),
                    }
                )

    chunks.sort(key=lambda c: c.get("score") or 0, reverse=True)
    limit = int(params.get("topK") or DEFAULT_TOPK)
    return {"chunks": chunks[:limit], "merged": len(groups) > 1}
