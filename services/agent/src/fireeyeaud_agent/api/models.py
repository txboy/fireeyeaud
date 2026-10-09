"""模型配置路由（设计 §14.8 / §17）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..config import store
from ..errors import ApiError
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["models"], dependencies=[Depends(require_token)])

KIND = "models"


class ModelBody(BaseModel):
    name: str
    provider: str = "openai"
    baseUrl: str
    model: str
    temperature: float = 0.2
    apiKeyRef: str | None = None
    isDefault: bool = False
    scope: str = "global"


class ModelPatch(BaseModel):
    name: str | None = None
    provider: str | None = None
    baseUrl: str | None = None
    model: str | None = None
    temperature: float | None = None
    apiKeyRef: str | None = None
    isDefault: bool | None = None


def _root():
    return workspace_manager.root


@router.get("/models")
def list_models(scope: str | None = Query(default=None)) -> dict:
    root = _root()
    if scope in ("global", "project"):
        items = store.list_items(KIND, scope, root)
    else:
        items = store.load_effective(KIND, root)
    return {"items": items, "nextCursor": None}


@router.post("/models")
def create_model(body: ModelBody) -> dict:
    return store.create_item(KIND, body.model_dump(), _root())


@router.patch("/models/{model_id}")
def update_model(
    model_id: str,
    body: ModelPatch,
    scope: str = Query(default="global"),
) -> dict:
    patch = body.model_dump(exclude_unset=True)
    return store.update_item(KIND, model_id, scope, patch, _root())


@router.delete("/models/{model_id}")
def delete_model(model_id: str, scope: str = Query(default="global")) -> dict:
    store.delete_item(KIND, model_id, scope, _root())
    return {"ok": True}


@router.post("/models/{model_id}/test")
def test_model(model_id: str, scope: str = Query(default="global")) -> dict:
    item = store.get_item(KIND, model_id, scope, _root())
    if item is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": model_id})
    ok = bool(item.get("baseUrl")) and bool(item.get("model"))
    return {"ok": ok}
