"""知识库 Provider 路由（设计 §14.8 / §14.19）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from .. import kb
from ..config import store
from ..errors import ApiError
from ..store import knowledge
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["knowledge"], dependencies=[Depends(require_token)])


class ProviderBody(BaseModel):
    type: str
    name: str
    baseUrl: str
    scope: str = "global"
    apiKey: str | None = None
    defaults: dict | None = None


class ProviderPatch(BaseModel):
    name: str | None = None
    baseUrl: str | None = None
    apiKey: str | None = None
    defaults: dict | None = None


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
    api_key = data.pop("apiKey", None)
    return knowledge.create_provider(data, api_key=api_key, root=_root())


@router.patch("/kb/providers/{provider_id}")
def update_provider(
    provider_id: str, body: ProviderPatch, scope: str = Query(default="global")
) -> dict:
    patch = body.model_dump(exclude_unset=True)
    api_key = patch.pop("apiKey", None)
    return knowledge.update_provider(
        provider_id, scope, patch, api_key=api_key, root=_root()
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
            provider["baseUrl"], knowledge.get_secret(provider_id) or ""
        )
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_KB_CONN", 502, "error.kbConn", {"reason": str(exc)}) from exc
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
            provider["baseUrl"], knowledge.get_secret(provider_id) or ""
        )
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_KB_CONN", 502, "error.kbConn", {"reason": str(exc)}) from exc
    return {"items": items, "nextCursor": None}


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
