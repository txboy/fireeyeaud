"""FastAPI 应用入口。"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import health, sessions
from .config.settings import settings

API_PREFIX = "/api/v1"


def create_app() -> FastAPI:
    app = FastAPI(title="fireeyeaud-agent", version=settings.app_version)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(sessions.router, prefix=API_PREFIX)
    return app


app = create_app()
