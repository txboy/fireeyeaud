"""数据库连接路由（设计 §14.8 / §14.9）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..errors import ApiError
from ..store import authorization, db, db_engine
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
    credRef: str | None = None
    path: str | None = None
    isDefault: bool = False


class TestBody(BaseModel):
    """按表单当前填写的连接参数试连（不落盘）。"""

    driver: str
    host: str | None = None
    port: int | None = None
    database: str | None = None
    username: str | None = None
    path: str | None = None
    # 明文密码仅在内存使用；缺省且给了 id 时回退到已保存凭据。
    password: str | None = None
    id: str | None = None
    scope: str | None = None


class AuthorizationBody(BaseModel):
    tables: dict[str, list[str]]


class ConnectionPatch(BaseModel):
    name: str | None = None
    driver: str | None = None
    host: str | None = None
    port: int | None = None
    database: str | None = None
    username: str | None = None
    credRef: str | None = None
    path: str | None = None
    isDefault: bool | None = None


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
    cred_ref = data.pop("credRef", None)
    return db.create_connection(data, cred_ref=cred_ref, root=root)


@router.delete("/db/connections/{connection_id}")
def delete_connection(connection_id: str, scope: str = Query(default="global")) -> dict:
    db.delete_connection(connection_id, scope, workspace_manager.root)
    return {"ok": True}


@router.patch("/db/connections/{connection_id}")
def update_connection(
    connection_id: str, body: ConnectionPatch, scope: str = Query(default="global")
) -> dict:
    data = body.model_dump(exclude_unset=True)
    cred_ref = data.pop("credRef", None)
    return db.update_connection(
        connection_id, scope, data, cred_ref=cred_ref, root=workspace_manager.root
    )


@router.post("/db/connections/{connection_id}/test")
def test_connection(connection_id: str, scope: str = Query(default="global")) -> dict:
    conn = db.get_connection(connection_id, scope, workspace_manager.root)
    if conn is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": connection_id})
    ok = db_engine.test_connection(
        conn, db.get_secret(conn.get("credRef") or connection_id)
    )
    return {"ok": ok}


@router.post("/db/test")
def test_connection_params(body: TestBody) -> dict:
    root = workspace_manager.root
    password = body.password
    if not password and body.id:
        conn = db.get_connection(body.id, body.scope or "global", root)
        if conn is not None:
            password = db.get_secret(conn.get("credRef") or body.id)
    conn = {
        "driver": body.driver,
        "host": body.host,
        "port": body.port,
        "database": body.database,
        "username": body.username,
        "path": body.path,
    }
    ok = db_engine.test_connection(conn, password)
    return {"ok": ok}


@router.patch("/db/connections/{connection_id}/authorization")
def set_authorization(connection_id: str, body: AuthorizationBody) -> dict:
    root = workspace_manager.root
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    authorization.set_entry(root, connection_id, body.tables)
    return {"ok": True, "tables": body.tables}


@router.post("/db/connections/{connection_id}/reflect")
def reflect_connection(
    connection_id: str, scope: str = Query(default="global")
) -> dict:
    root = workspace_manager.root
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    conn = db.get_connection(connection_id, scope, root)
    if conn is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": connection_id})
    return db_engine.reflect_and_register(
        root, conn, db.get_secret(conn.get("credRef") or connection_id)
    )
