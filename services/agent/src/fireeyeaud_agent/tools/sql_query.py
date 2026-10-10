"""sql_query：只读查询 + 沙箱 + 大结果落 artifacts（设计 §10.1 / §17.3）。"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..store.duckdb import Database
from ..store.sandbox import validate_sql
from .base import dump_artifact

DEFAULT_LIMIT = 200
MAX_LIMIT = 10000


def sql_query(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    source_id = params.get("sourceId")
    if source_id:
        from ..store import db as db_store
        from ..store import db_engine

        root = Path(root)
        conn = db_store.find_connection_for_source(root, source_id)
        if conn is None:
            raise ApiError(
                "E_DB_UNAUTHORIZED", 403, "error.dbUnauthorized", {"source": source_id}
            )
        sql = params.get("sql", "")
        db_engine.check_authorization(
            root, conn["id"], sql, db_engine.dialect_for(conn)
        )
        try:
            limit = int(params.get("limit") or DEFAULT_LIMIT)
        except (TypeError, ValueError):
            limit = DEFAULT_LIMIT
        return db_engine.run_query(
            conn,
            sql,
            db_store.get_secret(conn.get("credRef") or conn["id"]),
            limit=limit,
        )

    text = validate_sql(params.get("sql", ""))
    try:
        limit = int(params.get("limit") or DEFAULT_LIMIT)
    except (TypeError, ValueError):
        limit = DEFAULT_LIMIT
    limit = max(1, min(limit, MAX_LIMIT))

    first = text.split()[0].lower()
    db = Database(Path(root) / ".fireeye" / "workspace.duckdb")
    try:
        if first in ("explain", "describe"):
            cursor = db.query(text)
            columns = [d[0] for d in (cursor.description or [])]
            rows = cursor.fetchall()
            truncated = False
        else:
            cursor = db.query(f"SELECT * FROM ({text}) AS _sub LIMIT {limit + 1}")
            columns = [d[0] for d in (cursor.description or [])]
            fetched = cursor.fetchall()
            truncated = len(fetched) > limit
            rows = fetched[:limit]
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001 - 统一转错误码
        message = str(exc).lower()
        if "timeout" in message or "interrupt" in message:
            raise ApiError("E_SQL_TIMEOUT", 504, "error.sqlTimeout") from exc
        raise ApiError(
            "E_SQL_REJECTED", 400, "error.sqlRejected", {"reason": str(exc)}
        ) from exc
    finally:
        db.close()

    result: dict[str, Any] = {
        "columns": columns,
        "rows": [list(r) for r in rows],
        "rowCount": len(rows),
        "truncated": truncated,
    }
    if truncated:
        result["artifactRef"] = dump_artifact(
            Path(root),
            f"query_{uuid.uuid4().hex[:8]}",
            {"columns": columns, "rows": [list(r) for r in rows]},
        )
    return result
