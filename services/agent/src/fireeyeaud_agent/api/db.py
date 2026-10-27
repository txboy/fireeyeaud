"""数据库连接路由（设计 §14.8 / §14.9）。"""

from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

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
    # Oracle：连接方式（"service" 服务名 / "sid"）。
    connectBy: str | None = None


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
    connectBy: str | None = None


class AuthorizationBody(BaseModel):
    tables: dict[str, list[str]]


class QueryBody(BaseModel):
    """通用只读查询（表数据预览）：分页 + 可选总数。"""

    sql: str
    limit: int | None = None
    offset: int | None = None
    includeTotal: bool = True


class ValidateSqlBody(BaseModel):
    """纯语法校验：不连库，只按驱动方言解析。"""

    driver: str
    sql: str


class SqlChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class SqlChatBody(BaseModel):
    """SQL 助手对话：自然语言 → 只读 SQL（可读取样本行用于选表，不执行模型生成的 SQL）。"""

    scope: str = "global"
    connectionId: str
    table: str
    driver: str
    messages: list[SqlChatMessage] = []
    context: dict[str, Any] = {}
    locale: str | None = None
    modelId: str | None = None


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
    connectBy: str | None = None


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
    if db.is_builtin(str(data.get("id") or "")) or data.get("driver") == "duckdb":
        # 内置的「项目数据（DuckDB）」连接不可创建/覆盖。
        raise ApiError("E_DB_DRIVER", 400, "error.dbDriver", {"driver": "duckdb"})
    cred_ref = data.pop("credRef", None)
    return db.create_connection(data, cred_ref=cred_ref, root=root)


@router.delete("/db/connections/{connection_id}")
def delete_connection(connection_id: str, scope: str = Query(default="global")) -> dict:
    if db.is_builtin(connection_id):
        raise ApiError("E_PROTECTED", 400, "error.protected")
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
        "connectBy": body.connectBy,
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


@router.post("/db/validate-sql")
def validate_sql_syntax(body: ValidateSqlBody) -> dict:
    """编辑器实时语法检查：只解析，不访问数据库。"""
    return db_engine.validate_sql_syntax(body.sql, body.driver)


# ---- 工作区 DuckDB：文件型数据源的 SQL 预览 ----
# 内置连接不进连接列表，也不允许被创建/删除/修改；这里只暴露「看表结构 + 只读查询」。


def _workspace_duckdb():
    root = workspace_manager.root
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    return db.workspace_duckdb_connection(root)


def _require_source_table(table: str) -> None:
    """只允许查已导入的 src_* 原始表，避免把 workspace.duckdb 里的内部表暴露出去。"""
    if not table.startswith("src_"):
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": table})


@router.get("/datasources/workspace-duckdb/tables/{table}")
def workspace_table_schema(table: str) -> dict:
    """预览页需要的最小表结构（默认 SQL、字段补全与表头）。"""
    _require_source_table(table)
    schema = db_engine.duckdb_inspect_table(_workspace_duckdb(), table)
    if schema is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": table})
    return schema


@router.post("/datasources/workspace-duckdb/query")
def workspace_duckdb_query(body: QueryBody) -> dict:
    """在工作区 DuckDB 上执行只读 SQL 并分页返回（表数据预览）。"""
    conn = _workspace_duckdb()
    try:
        limit = int(body.limit or db_engine.DEFAULT_LIMIT)
    except (TypeError, ValueError):
        limit = db_engine.DEFAULT_LIMIT
    limit = max(1, min(limit, db_engine.MAX_LIMIT))
    try:
        offset = int(body.offset or 0)
    except (TypeError, ValueError):
        offset = 0
    offset = max(0, offset)

    result = db_engine.run_query(conn, body.sql, None, limit=limit, offset=offset)
    total = (
        db_engine.count_query(conn, body.sql, None) if body.includeTotal else None
    )
    return {
        "columns": result["columns"],
        "rows": result["rows"],
        "rowCount": result["rowCount"],
        "hasMore": result["hasMore"],
        "paginated": result["paginated"],
        "total": total,
        "limit": limit,
        "offset": offset,
        "sql": result["sql"],
    }


def _known_model_id(root, model_id: str | None) -> str | None:
    """只接受已配置的模型 id；未知 id 返回 None（由 build_chat_model 取默认模型）。"""
    if not model_id:
        return None
    from ..config.models import select_profile

    return model_id if select_profile(root, model_id) is not None else None


@router.post("/db/sql-chat")
async def db_sql_chat(body: SqlChatBody) -> EventSourceResponse:
    """SQL 助手：自然语言 → 只读 SQL，流式返回。

    可按表名读取样本行（`SELECT ... LIMIT 5`，SQL 由服务端拼接），但不执行模型生成的
    SQL、不返回全量数据；凭据只在服务端用于建连，不进提示词与事件。
    """
    # 惰性导入：SQL 助手会拉起 LLM 栈，路由模块导入时不需要。
    from ..agent.sql_assistant import SAMPLE_ROWS, build_preview_sql, stream_sql_assistant

    root = workspace_manager.root
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    conn = db.get_connection(body.connectionId, body.scope, root)
    if conn is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": body.connectionId})

    # 驱动以服务端连接记录为准，避免前端谎报方言。
    driver = str(conn.get("driver") or body.driver)
    context = body.context if isinstance(body.context, dict) else {}
    connection_ctx = context.get("connection")
    context = {
        **context,
        "connection": {
            **(connection_ctx if isinstance(connection_ctx, dict) else {}),
            "id": conn.get("id", body.connectionId),
            "name": conn.get("name") or "",
            "driver": driver,
            "database": conn.get("database"),
        },
    }
    trusted = body.model_copy(update={"driver": driver, "context": context})

    # modelId 只允许指向已配置的模型；未知 / 未配置一律回退默认模型（计划：v1 用默认模型）。
    trusted = trusted.model_copy(update={"modelId": _known_model_id(root, body.modelId)})

    # 样本行工具：凭据只在本闭包内用于建连；SQL 恒由服务端按表名拼接。
    # 走预览通道（与表数据预览一致），不套用审计用的表/字段授权。
    password = db.get_secret(conn.get("credRef") or body.connectionId)

    def preview(table: str) -> dict:
        return db_engine.run_query(
            conn,
            build_preview_sql(driver, table),
            password,
            limit=SAMPLE_ROWS,
        )

    async def event_stream():
        async for envelope in stream_sql_assistant(
            root=root, body=trusted, preview=preview
        ):
            yield {
                "event": "message",
                "data": json.dumps(envelope, ensure_ascii=False, default=str),
            }

    return EventSourceResponse(event_stream(), media_type="text/event-stream")


@router.post("/db/connections/{connection_id}/query")
def run_connection_query(
    connection_id: str, body: QueryBody, scope: str = Query(default="global")
) -> dict:
    """执行只读 SQL 并分页返回（表数据预览；不受表/字段授权限制）。"""
    root = workspace_manager.root
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    conn = db.get_connection(connection_id, scope, root)
    if conn is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": connection_id})
    password = db.get_secret(conn.get("credRef") or connection_id)
    try:
        limit = int(body.limit or db_engine.DEFAULT_LIMIT)
    except (TypeError, ValueError):
        limit = db_engine.DEFAULT_LIMIT
    limit = max(1, min(limit, db_engine.MAX_LIMIT))
    try:
        offset = int(body.offset or 0)
    except (TypeError, ValueError):
        offset = 0
    offset = max(0, offset)

    result = db_engine.run_query(
        conn, body.sql, password, limit=limit, offset=offset
    )
    total = db_engine.count_query(conn, body.sql, password) if body.includeTotal else None
    return {
        "columns": result["columns"],
        "rows": result["rows"],
        "rowCount": result["rowCount"],
        "hasMore": result["hasMore"],
        "paginated": result["paginated"],
        "total": total,
        "limit": limit,
        "offset": offset,
        "sql": result["sql"],
    }
