"""数据库连接路由（设计 §14.8 / §14.9）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..errors import ApiError
from ..store import db, db_engine
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["db"], dependencies=[Depends(require_token)])


class ConnectionBody(BaseModel):
    name: str
    driver: str
    scope: str = "global"
    host: str | None = None
    port: int | None = None
    database: str | None = None
    username: str | None = None
    password: str | None = None
    path: str | None = None


@router.get("/db/connections")
def list_connections(scope: str | None = Query(default=None)) -> dict:
    root = workspace_manager.root
    if scope in ("global", "project"):
        return {"items": db.store.list_items(db.KIND, scope, root), "nextCursor": None}
    return {"items": db.list_connections(root), "nextCursor": None}


@router.post("/db/connections")
def create_connection(body: ConnectionBody) -> dict:
    root = workspace_manager.root
    data = body.model_dump()
    password = data.pop("password", None)
    return db.create_connection(data, password=password, root=root)


@router.delete("/db/connections/{connection_id}")
def delete_connection(connection_id: str, scope: str = Query(default="global")) -> dict:
    db.delete_connection(connection_id, scope, workspace_manager.root)
    return {"ok": True}


@router.post("/db/connections/{connection_id}/test")
def test_connection(connection_id: str, scope: str = Query(default="global")) -> dict:
    conn = db.get_connection(connection_id, scope, workspace_manager.root)
    if conn is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": connection_id})
    ok = db_engine.test_connection(conn, db.get_secret(connection_id))
    return {"ok": ok}
