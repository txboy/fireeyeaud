"""健康检查。"""

from __future__ import annotations

from fastapi import APIRouter

from ..config.settings import settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "appVersion": settings.app_version,
        "schemaVersion": settings.schema_version,
    }
