"""知识库 Provider 路由（设计 §14.8 / §14.19）。"""

from __future__ import annotations

import time

import httpx
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from .. import kb
from ..config import store
from ..errors import ApiError
from ..store import knowledge
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["knowledge"], dependencies=[Depends(require_token)])


def _reason(exc: Exception) -> str:
    """把适配器异常压缩成可读原因；HTTP 错误附带响应体片段，便于定位。"""
    if isinstance(exc, httpx.HTTPStatusError):
        body = (exc.response.text or "").strip().replace("\n", " ")
        return f"{exc} | {body[:300]}" if body else str(exc)
    return str(exc)


class ProviderBody(BaseModel):
    type: str
    name: str
    baseUrl: str
    scope: str = "global"
    apiKeyRef: str | None = None
    defaults: dict | None = None
    isDefault: bool = False


class ProviderPatch(BaseModel):
    name: str | None = None
    baseUrl: str | None = None
    apiKeyRef: str | None = None
    defaults: dict | None = None
    isDefault: bool | None = None


class EnabledBody(BaseModel):
    scope: str = "global"
    items: list[dict]


def _root():
    return workspace_manager.root


@router.get("/kb/providers")
def list_providers(scope: str | None = Query(default=None)) -> dict:
    root = _root()
    if scope in ("global", "project"):
        return {
            "items": store.list_items(knowledge.KIND, scope, root),
            "nextCursor": None,
        }
    return {"items": knowledge.list_providers(root), "nextCursor": None}


@router.post("/kb/providers")
def create_provider(body: ProviderBody) -> dict:
    data = body.model_dump()
    api_key_ref = data.pop("apiKeyRef", None)
    return knowledge.create_provider(data, api_key_ref=api_key_ref, root=_root())


@router.patch("/kb/providers/{provider_id}")
def update_provider(
    provider_id: str, body: ProviderPatch, scope: str = Query(default="global")
) -> dict:
    patch = body.model_dump(exclude_unset=True)
    api_key_ref = patch.pop("apiKeyRef", None)
    return knowledge.update_provider(
        provider_id, scope, patch, api_key_ref=api_key_ref, root=_root()
    )


@router.delete("/kb/providers/{provider_id}")
def delete_provider(provider_id: str, scope: str = Query(default="global")) -> dict:
    knowledge.delete_provider(provider_id, scope, _root())
    return {"ok": True}


@router.post("/kb/providers/{provider_id}/test")
def test_provider(provider_id: str, scope: str = Query(default="global")) -> dict:
    provider = knowledge.get_provider(provider_id, scope, _root())
    if provider is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": provider_id})
    try:
        items = kb.adapter_for(provider["type"]).list_knowledge(
            provider["baseUrl"],
            knowledge.get_secret(provider.get("apiKeyRef") or provider_id) or "",
        )
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError("E_KB_CONN", 502, "error.kbConn", {"reason": _reason(exc)}) from exc
    return {"ok": True, "knowledgeCount": len(items)}


class KbTestBody(BaseModel):
    type: str
    baseUrl: str
    # 明文 key 仅在内存使用；缺省且给了 id 时回退到已保存凭据。
    apiKey: str | None = None
    id: str | None = None
    scope: str | None = None


@router.post("/kb/test")
def test_provider_params(body: KbTestBody) -> dict:
    """按表单当前填写值试连（不落盘）。"""
    api_key = body.apiKey
    if not api_key and body.id:
        provider = knowledge.get_provider(body.id, body.scope or "global", _root())
        if provider is not None:
            api_key = knowledge.get_secret(provider.get("apiKeyRef") or body.id)
    try:
        items = kb.adapter_for(body.type).list_knowledge(body.baseUrl, api_key or "")
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError("E_KB_CONN", 502, "error.kbConn", {"reason": _reason(exc)}) from exc
    return {"ok": True, "knowledgeCount": len(items)}


@router.get("/kb/providers/{provider_id}/knowledge")
def list_remote_knowledge(
    provider_id: str, scope: str = Query(default="global")
) -> dict:
    provider = knowledge.get_provider(provider_id, scope, _root())
    if provider is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": provider_id})
    try:
        items = kb.adapter_for(provider["type"]).list_knowledge(
            provider["baseUrl"],
            knowledge.get_secret(provider.get("apiKeyRef") or provider_id) or "",
        )
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError("E_KB_CONN", 502, "error.kbConn", {"reason": _reason(exc)}) from exc
    return {"items": items, "nextCursor": None}


class KbQueryBody(BaseModel):
    query: str
    scope: str = "global"
    # 显式指定远端库；缺省则回退到该 Provider 已启用的库，仍为空则取全部远端库。
    knowledgeIds: list[str] | None = None
    topK: int | None = None


@router.post("/kb/providers/{provider_id}/query")
def query_provider(provider_id: str, body: KbQueryBody) -> dict:
    """按文本试检索该 Provider 的远端知识库，返回命中片段与耗时（不落盘、不写证据）。"""
    root = _root()
    provider = knowledge.get_provider(provider_id, body.scope, root)
    if provider is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": provider_id})

    query = (body.query or "").strip()
    if not query:
        raise ApiError("E_KB_QUERY", 400, "error.internal")

    adapter = kb.adapter_for(provider["type"])
    key = knowledge.get_secret(provider.get("apiKeyRef") or provider_id) or ""

    ids = [str(i) for i in (body.knowledgeIds or []) if i]
    names: dict[str, str] = {}
    if not ids:
        # 回退：该 Provider 在当前作用域下已启用的库。
        for e in knowledge.list_enabled_effective(root):
            if (
                str(e.get("providerId")) == provider_id
                and e.get("enabled")
                and e.get("knowledgeId")
            ):
                kid = str(e.get("knowledgeId"))
                ids.append(kid)
                names[kid] = str(e.get("name") or "")
    if not ids:
        # 仍为空：取全部远端库，便于未启用时也能试检索。
        try:
            for item in adapter.list_knowledge(provider["baseUrl"], key):
                if item.get("id"):
                    kids = str(item["id"])
                    ids.append(kids)
                    names[kids] = str(item.get("name") or "")
        except ApiError:
            raise
        except Exception as exc:
            raise ApiError("E_KB_CONN", 502, "error.kbConn", {"reason": _reason(exc)}) from exc

    defaults = provider.get("defaults") or {}
    top_k = body.topK or defaults.get("topK")
    threshold = defaults.get("scoreThreshold")

    started = time.perf_counter()
    hits: list[dict] = []
    for kid in ids:
        try:
            found = adapter.retrieve(
                provider["baseUrl"],
                key,
                kid,
                query,
                top_k=top_k,
                score_threshold=threshold,
                search_method=defaults.get("searchMethod", "hybrid_search"),
            )
        except ApiError:
            raise
        except Exception as exc:
            raise ApiError("E_KB_CONN", 502, "error.kbConn", {"reason": _reason(exc)}) from exc
        for h in found:
            hits.append(
                {
                    "knowledgeId": kid,
                    "knowledgeName": names.get(kid, ""),
                    "docId": h.get("docId"),
                    "docName": h.get("docName"),
                    "content": h.get("content"),
                    "score": h.get("score"),
                    "url": h.get("url"),
                }
            )
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    hits.sort(key=lambda c: c.get("score") or 0, reverse=True)
    return {
        "ok": True,
        "elapsedMs": elapsed_ms,
        "knowledgeCount": len(ids),
        "hits": hits,
    }


@router.get("/kb/enabled")
def get_enabled(scope: str | None = Query(default=None)) -> dict:
    root = _root()
    if scope in ("global", "project"):
        return {"items": knowledge.list_enabled(scope, root), "nextCursor": None}
    return {"items": knowledge.list_enabled_effective(root), "nextCursor": None}


@router.patch("/kb/enabled")
def patch_enabled(body: EnabledBody) -> dict:
    if body.scope not in ("global", "project"):
        raise ApiError("E_INVALID_SCOPE", 400, "error.internal")
    items = knowledge.set_enabled(body.scope, body.items, _root())
    return {"ok": True, "items": items}
