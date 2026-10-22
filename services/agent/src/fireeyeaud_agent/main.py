"""FastAPI 应用入口。"""

from __future__ import annotations

import sys

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import (
    archive as archive_api,
    datasources,
    db,
    evidence,
    evidence_forms as evidence_forms_api,
    export,
    findings,
    graph,
    health,
    knowledge as knowledge_api,
    mcp as mcp_api,
    models,
    reports as reports_api,
    rules,
    secrets as secrets_api,
    templates as templates_api,
    sessions,
    settings as settings_api,
    skills as skills_api,
    workspaces,
)
from .config.settings import settings
from .errors import ApiError

API_PREFIX = "/api/v1"

# 确保日志（含中文）以 UTF-8 输出，避免被管道按本地代码页编码成乱码。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    except (AttributeError, ValueError):
        pass


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
    app.include_router(archive_api.router, prefix=API_PREFIX)
    app.include_router(workspaces.router, prefix=API_PREFIX)
    app.include_router(datasources.router, prefix=API_PREFIX)
    app.include_router(findings.router, prefix=API_PREFIX)
    app.include_router(evidence.router, prefix=API_PREFIX)
    app.include_router(models.router, prefix=API_PREFIX)
    app.include_router(rules.router, prefix=API_PREFIX)
    app.include_router(graph.router, prefix=API_PREFIX)
    app.include_router(export.router, prefix=API_PREFIX)
    app.include_router(db.router, prefix=API_PREFIX)
    app.include_router(knowledge_api.router, prefix=API_PREFIX)
    app.include_router(mcp_api.router, prefix=API_PREFIX)
    app.include_router(skills_api.router, prefix=API_PREFIX)
    app.include_router(secrets_api.router, prefix=API_PREFIX)
    app.include_router(templates_api.router, prefix=API_PREFIX)
    app.include_router(evidence_forms_api.router, prefix=API_PREFIX)
    app.include_router(reports_api.router, prefix=API_PREFIX)
    app.include_router(sessions.router, prefix=API_PREFIX)
    app.include_router(settings_api.router, prefix=API_PREFIX)
    return app


app = create_app()
