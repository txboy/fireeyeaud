"""FastAPI 应用入口。"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import (
    datasources,
    evidence,
    findings,
    health,
    models,
    sessions,
    workspaces,
)
from .config.settings import settings
from .errors import ApiError

API_PREFIX = "/api/v1"


def create_app() -> FastAPI:
    app = FastAPI(title="fireeyeaud-agent", version=settings.app_version)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(ApiError)
    async def _api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
        envelope = exc.envelope
        envelope["error"]["traceId"] = request.headers.get("x-trace-id")
        return JSONResponse(status_code=exc.http_status, content=envelope)

    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(workspaces.router, prefix=API_PREFIX)
    app.include_router(datasources.router, prefix=API_PREFIX)
    app.include_router(findings.router, prefix=API_PREFIX)
    app.include_router(evidence.router, prefix=API_PREFIX)
    app.include_router(models.router, prefix=API_PREFIX)
    app.include_router(sessions.router, prefix=API_PREFIX)
    return app


app = create_app()
