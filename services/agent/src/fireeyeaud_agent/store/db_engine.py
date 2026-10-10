"""数据库引擎层：建连、反射、只读查询（设计 §9 / §17.3）。

- SQLAlchemy 统一层（sqlite/postgresql/mysql/mssql/access）。
- 只读：仅 SELECT/WITH/EXPLAIN/DESCRIBE（复用 sandbox）；SQLite 以 mode=ro 打开。
- 连接 / 反射 / 查询失败统一转 E_DB_CONN。
"""

from __future__ import annotations

from typing import Any

from ..errors import ApiError
from .db import build_url
from .sandbox import validate_sql

DEFAULT_LIMIT = 200
MAX_LIMIT = 10000


def _connect_kwargs(conn: dict[str, Any]) -> dict[str, Any]:
    if str(conn.get("driver") or "").lower() == "sqlite":
        return {"connect_args": {"uri": True}}
    return {}


def _engine(conn: dict[str, Any], password: str | None):
    from sqlalchemy import create_engine

    url = build_url(conn, password)
    if str(conn.get("driver") or "").lower() == "sqlite":
        base = url.replace("sqlite:///", "sqlite:///file:", 1)
        url = f"{base}?mode=ro&uri=true"
    try:
        return create_engine(url, **_connect_kwargs(conn))
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc


def test_connection(conn: dict[str, Any], password: str | None) -> bool:
    from sqlalchemy import text

    try:
        engine = _engine(conn, password)
        with engine.connect() as con:
            con.execute(text("SELECT 1"))
        return True
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc


def reflect(conn: dict[str, Any], password: str | None) -> list[dict[str, Any]]:
    from sqlalchemy import inspect

    try:
        engine = _engine(conn, password)
        insp = inspect(engine)
        result: list[dict[str, Any]] = []
        for table in insp.get_table_names():
            columns = [
                {"name": c["name"], "type": str(c.get("type") or "")}
                for c in insp.get_columns(table)
            ]
            result.append({"table": table, "columns": columns})
        return result
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc


def run_query(
    conn: dict[str, Any],
    sql: str,
    password: str | None,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    from sqlalchemy import text

    text_sql = validate_sql(sql)
    try:
        limit = int(limit or DEFAULT_LIMIT)
    except (TypeError, ValueError):
        limit = DEFAULT_LIMIT
    limit = max(1, min(limit, MAX_LIMIT))
    first = text_sql.split()[0].lower()
    try:
        engine = _engine(conn, password)
        with engine.connect() as con:
            if first in ("explain", "describe"):
                cursor = con.execute(text(text_sql))
            else:
                cursor = con.execute(
                    text(f"SELECT * FROM ({text_sql}) AS _sub LIMIT {limit + 1}")
                )
            columns = list(cursor.keys())
            fetched = cursor.fetchall()
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc
    truncated = len(fetched) > limit
    rows = [list(r) for r in fetched[:limit]]
    return {
        "columns": columns,
        "rows": rows,
        "rowCount": len(rows),
        "truncated": truncated,
    }


_DIALECT = {
    "sqlite": "sqlite",
    "postgresql": "postgres",
    "mysql": "mysql",
    "mssql": "tsql",
    "access": "tsql",
}


def dialect_for(conn: dict[str, Any]) -> str:
    return _DIALECT.get(str(conn.get("driver") or "").lower(), "sqlite")


def check_authorization(root, connection_id: str, sql: str, dialect: str) -> None:
    import sqlglot
    from sqlglot import exp

    from . import authorization

    allowed = authorization.get(root, connection_id)
    try:
        tree = sqlglot.parse_one(sql, read=dialect)
    except Exception as exc:  # noqa: BLE001
        raise ApiError(
            "E_DB_UNAUTHORIZED", 403, "error.dbUnauthorized", {"reason": "parse"}
        ) from exc
    tables = {t.name for t in tree.find_all(exp.Table)}
    for table in tables:
        if table not in allowed:
            raise ApiError(
                "E_DB_UNAUTHORIZED", 403, "error.dbUnauthorized", {"table": table}
            )
    for col in tree.find_all(exp.Column):
        name = col.name
        if name == "*" or not name:
            continue
        qualified = col.table
        if qualified and qualified in allowed:
            if not authorization.column_allowed(root, connection_id, qualified, name):
                raise ApiError(
                    "E_DB_UNAUTHORIZED", 403, "error.dbUnauthorized", {"column": name}
                )
            continue
        if not any(
            authorization.column_allowed(root, connection_id, t, name) for t in allowed
        ):
            raise ApiError(
                "E_DB_UNAUTHORIZED", 403, "error.dbUnauthorized", {"column": name}
            )


def reflect_and_register(
    root, conn: dict[str, Any], password: str | None
) -> dict[str, Any]:
    from pathlib import Path

    from . import authorization
    from .index import upsert_schema_entry
    from .project import ensure_project, next_counter, save_project

    root = Path(root)
    fe = root / ".fireeye"
    schema = reflect(conn, password)
    project = ensure_project(fe, root)
    ds_seq = next_counter(fe, "dataSource", root)
    ds_id = f"ds_{ds_seq}"
    for entry in schema:
        upsert_schema_entry(
            fe / "index" / "schema.json",
            {
                "sourceId": ds_id,
                "connectionId": conn["id"],
                "table": entry["table"],
                "rowCount": None,
                "columns": [
                    {"name": c["name"], "type": c["type"], "sample": ""}
                    for c in entry["columns"]
                ],
            },
        )
    project.setdefault("dataSources", []).append(
        {
            "id": ds_id,
            "type": "db",
            "connectionId": conn["id"],
            "tables": [e["table"] for e in schema],
            "importedAt": None,
        }
    )
    save_project(fe, project)
    return {
        "sourceId": ds_id,
        "tables": [e["table"] for e in schema],
        "authorization": authorization.get(root, conn["id"]),
    }
