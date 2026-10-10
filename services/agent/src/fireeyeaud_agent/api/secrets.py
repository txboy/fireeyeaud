"""凭据下发路由（设计 §17.2）。仅 127.0.0.1 + token，写入内存，不落盘。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..store import secrets
from .deps import require_token

router = APIRouter(tags=["secrets"], dependencies=[Depends(require_token)])


class SecretsBody(BaseModel):
    items: dict[str, str]


@router.post("/secrets")
def push_secrets(body: SecretsBody) -> dict:
    secrets.set_all(body.items)
    return {"ok": True, "count": len(body.items)}
