"""FastAPI 依赖：可选的 Bearer token 校验。"""

from __future__ import annotations

from fastapi import Header, HTTPException

from ..config.settings import settings


async def require_token(authorization: str | None = Header(default=None)) -> None:
    """当设置了 FIREYEAUD_TOKEN 时校验请求头；未设置则放行（dev）。"""
    if not settings.token:
        return
    if authorization != f"Bearer {settings.token}":
        raise HTTPException(status_code=401, detail="unauthorized")
