"""应用设置路由（设计 §14.8）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..store import app_settings
from .deps import require_token

router = APIRouter(tags=["settings"], dependencies=[Depends(require_token)])


class WebSearchBody(BaseModel):
    enabled: bool | None = None
    provider: str | None = None
    keyRef: str | None = None
    baseUrl: str | None = None


class CompactionBody(BaseModel):
    auto: bool | None = None
    keepTokens: int | None = None
    reserveOutputTokens: int | None = None
    threshold: float | None = None


class SkillsBody(BaseModel):
    mode: str | None = None


class ArchiveBody(BaseModel):
    authorName: str | None = None
    authorEmail: str | None = None


class SettingsPatch(BaseModel):
    locale: str | None = None
    theme: str | None = None
    systemPrompt: str | None = None
    webSearch: WebSearchBody | None = None
    compaction: CompactionBody | None = None
    skills: SkillsBody | None = None
    archive: ArchiveBody | None = None


@router.get("/settings")
def get_settings() -> dict:
    return app_settings.load()


@router.patch("/settings")
def patch_settings(body: SettingsPatch) -> dict:
    update = body.model_dump(exclude_unset=True)
    return app_settings.patch(update)
