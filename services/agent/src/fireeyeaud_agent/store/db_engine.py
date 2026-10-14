"""数据库引擎层：建连、反射、只读查询（设计 §9 / §17.3）。

- SQLAlchemy 统一层（sqlite/postgresql/mysql/mssql/access/oracle）。
- 只读：仅 SELECT/WITH/EXPLAIN/DESCRIBE（复用 sandbox）；SQLite 以 mode=ro 打开。
- 连接 / 反射 / 查询失败统一转 E_DB_CONN。
"""

from __future__ import annotations

import contextlib
import warnings
from typing import Any

from ..errors import ApiError
from . import access_source
from .db import build_url
from .sandbox import validate_sql

DEFAULT_LIMIT = 200
MAX_LIMIT = 10000


@contextlib.contextmanager
def _suppress_sa_warnings():
    """反射时忽略 SQLAlchemy 对未知列类型的告警（如 Oracle 的 LONG RAW / ANYDATA）。"""
    from sqlalchemy.exc import SAWarning

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SAWarning)
        yield

# 连接超时（秒）：不可达 / 无响应主机应快速失败，避免测试连通长时间无反馈。
CONNECT_TIMEOUT = 15


def _connect_kwargs(conn: dict[str, Any]) -> dict[str, Any]:
    driver = str(conn.get("driver") or "").lower()
    if driver == "sqlite":
        return {"connect_args": {"uri": True, "timeout": CONNECT_TIMEOUT}}
    if driver in ("postgresql", "mysql"):
        return {"connect_args": {"connect_timeout": CONNECT_TIMEOUT}}
    if driver in ("mssql", "access"):
        return {"connect_args": {"timeout": CONNECT_TIMEOUT}}
    if driver == "oracle":
        return {"connect_args": {"tcp_connect_timeout": CONNECT_TIMEOUT}}
    return {}


def _engine(conn: dict[str, Any], password: str | None):
    from sqlalchemy import create_engine

    url = build_url(conn, password)
    driver = str(conn.get("driver") or "").lower()
    if driver == "sqlite":
        base = url.replace("sqlite:///", "sqlite:///file:", 1)
        url = f"{base}?mode=ro&uri=true"
    kwargs = _connect_kwargs(conn)
    if driver == "oracle":
        # Oracle 的表常位于 SYSTEM/SYSAUX 表空间（尤其 SYSTEM/SYS 用户）。
        # SQLAlchemy 的 Oracle 方言默认排除这两个表空间，会导致反射出 0 张表。
        kwargs["exclude_tablespaces"] = []
    try:
        return create_engine(url, **kwargs)
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc


def _probe_query(driver: str) -> str:
    """连通性探测 SQL；Oracle 的 SELECT 必须带 FROM dual。"""
    return "SELECT 1 FROM dual" if driver == "oracle" else "SELECT 1"


def test_connection(conn: dict[str, Any], password: str | None) -> bool:
    from sqlalchemy import text

    driver = str(conn.get("driver") or "").lower()
    try:
        engine = _engine(conn, password)
        with engine.connect() as con:
            con.execute(text(_probe_query(driver)))
        return True
    except ApiError:
        if driver == "access":
            return _access_probe(conn)
        raise
    except Exception as exc:  # noqa: BLE001
        if driver == "access":
            return _access_probe(conn)
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc


def _column_meta(col: dict[str, Any], *, is_pk: bool = False) -> dict[str, Any]:
    """把 SQLAlchemy inspector 的列信息映射为前端所需结构（含注释）。"""
    return {
        "name": col.get("name"),
        "type": str(col.get("type") or ""),
        "comment": col.get("comment"),
        "nullable": bool(col.get("nullable", True)),
        "primaryKey": is_pk,
    }


def _reflect_name(driver: str, name: str) -> str:
    """SQLAlchemy 会把 Oracle 反射名小写化；还原为真实名字（未加引号时为大写）。"""
    if driver == "oracle":
        return str(name).upper()
    return name


def reflect(conn: dict[str, Any], password: str | None) -> list[dict[str, Any]]:
    from sqlalchemy import inspect

    driver = str(conn.get("driver") or "").lower()
    try:
        engine = _engine(conn, password)
        insp = inspect(engine)
        result: list[dict[str, Any]] = []
        with _suppress_sa_warnings():
            for table in insp.get_table_names():
                try:
                    table_comment = (insp.get_table_comment(table) or {}).get("text")
                except Exception:  # noqa: BLE001 - 部分驱动不支持表注释
                    table_comment = None
                try:
                    pk_cols = set(
                        (insp.get_pk_constraint(table) or {}).get(
                            "constrained_columns"
                        )
                        or []
                    )
                except Exception:  # noqa: BLE001
                    pk_cols = set()
                columns = [
                    _column_meta(c, is_pk=c["name"] in pk_cols)
                    for c in insp.get_columns(table)
                ]
                if driver == "oracle":
                    for col in columns:
                        col["name"] = _reflect_name(driver, col.get("name") or "")
                result.append(
                    {
                        "table": _reflect_name(driver, table),
                        "comment": table_comment,
                        "columns": columns,
                    }
                )
        return result
    except ApiError:
        if str(conn.get("driver") or "").lower() == "access":
            return _access_reflect(conn)
        raise
    except Exception as exc:  # noqa: BLE001
        if str(conn.get("driver") or "").lower() == "access":
            return _access_reflect(conn)
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc


def _has_top_level_limit(sql: str, dialect: str) -> bool:
    """检测最外层查询是否自带 LIMIT（子查询里的不算）。"""
    try:
        import sqlglot

        tree = sqlglot.parse_one(sql, read=dialect)
        return tree.args.get("limit") is not None
    except Exception:  # noqa: BLE001 - 解析失败则按“无 LIMIT”处理（照常包装）
        return False


def _has_top_level_order(sql: str, dialect: str) -> bool:
    """检测最外层查询是否自带 ORDER BY。"""
    try:
        import sqlglot

        tree = sqlglot.parse_one(sql, read=dialect)
        return tree.args.get("order") is not None
    except Exception:  # noqa: BLE001 - 解析失败则按“无 ORDER BY”处理
        return False


def _strip_top_level_order(sql: str, dialect: str) -> str:
    """去掉最外层 ORDER BY 并重新生成 SQL。

    用于 MSSQL 计数：T-SQL 的派生表里不允许出现 ORDER BY（除非有 TOP/OFFSET）。
    """
    try:
        import sqlglot

        tree = sqlglot.parse_one(sql, read=dialect)
        tree.set("order", None)
        return tree.sql(dialect=dialect)
    except Exception:  # noqa: BLE001 - 解析失败则原样返回
        return sql


def _wrap_subquery(driver: str, text_sql: str) -> str:
    """把子查询包一层并加别名。

    - Oracle 不允许表别名使用 AS（ORA-00933），且未加引号的标识符不能以 `_` 开头
      （ORA-00911），故别名用 `sub`。
    """
    if driver == "oracle":
        return f"({text_sql}) sub"
    return f"({text_sql}) AS _sub"


def _page_sql(
    driver: str,
    text_sql: str,
    limit: int,
    offset: int,
    server_version: tuple[int, ...] | None = None,
) -> tuple[str, int, int]:
    """生成「从 offset 起取 limit+1 行」的分页 SQL。

    返回 (可执行 SQL, 需在应用侧丢弃的前置行数, 需丢弃的末尾列数)。
    - PG/MySQL/SQLite：包一层派生表 + `LIMIT n OFFSET m`。
    - MSSQL：T-SQL 不允许派生表里出现 ORDER BY，故**不包装**，直接把
      `OFFSET m ROWS FETCH NEXT n ROWS ONLY` 追加到原查询末尾（无 ORDER BY 时补
      `ORDER BY (SELECT NULL)`）。
    - Oracle 12c+：`OFFSET m ROWS FETCH NEXT n ROWS ONLY`（别名不带 AS）。
    - Oracle 11g 及更早：`ROWNUM` 双层包装，末尾多出 `rnum` 列需调用方丢弃。
    - Access(Jet)：无 OFFSET，用 `TOP (m+n)` 取到再从应用侧切掉前 m 行。
    """
    take = limit + 1
    if driver == "mssql":
        prefix = (
            "" if _has_top_level_order(text_sql, "tsql") else " ORDER BY (SELECT NULL)"
        )
        return (
            f"{text_sql}{prefix} OFFSET {offset} ROWS FETCH NEXT {take} ROWS ONLY",
            0,
            0,
        )
    if driver == "oracle":
        if server_version and server_version[0] < 12:
            return (
                "SELECT * FROM (SELECT a.*, ROWNUM rnum FROM "
                f"({text_sql}) a "
                f"WHERE ROWNUM <= {offset + take}) WHERE rnum > {offset}",
                0,
                1,
            )
        return (
            f"SELECT * FROM {_wrap_subquery(driver, text_sql)} "
            f"OFFSET {offset} ROWS FETCH NEXT {take} ROWS ONLY",
            0,
            0,
        )
    if driver == "access":
        return f"SELECT TOP {offset + take} * FROM ({text_sql}) AS _sub", offset, 0
    return f"SELECT * FROM ({text_sql}) AS _sub LIMIT {take} OFFSET {offset}", 0, 0


def run_query(
    conn: dict[str, Any],
    sql: str,
    password: str | None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> dict[str, Any]:
    from sqlalchemy import text

    text_sql = validate_sql(sql)
    try:
        limit = int(limit or DEFAULT_LIMIT)
    except (TypeError, ValueError):
        limit = DEFAULT_LIMIT
    limit = max(1, min(limit, MAX_LIMIT))
    try:
        offset = int(offset or 0)
    except (TypeError, ValueError):
        offset = 0
    offset = max(0, offset)
    first = text_sql.split()[0].lower()
    executed = text_sql
    drop_tail = 0
    # EXPLAIN/DESCRIBE、或用户 SQL 自带 LIMIT 时按原样执行，不额外包装/分页。
    paginated = first not in ("explain", "describe") and not _has_top_level_limit(
        text_sql, dialect_for(conn)
    )
    try:
        engine = _engine(conn, password)
        with engine.connect() as con:
            if not paginated:
                cursor = con.execute(text(text_sql))
                fetched = cursor.fetchall()
                has_more = False
                rows = [list(r) for r in fetched]
            else:
                driver = str(conn.get("driver") or "").lower()
                server_version = getattr(con.dialect, "server_version_info", None)
                executed, drop_lead, drop_tail = _page_sql(
                    driver, text_sql, limit, offset, server_version
                )
                cursor = con.execute(text(executed))
                fetched = cursor.fetchall()
                if drop_lead:
                    fetched = fetched[drop_lead:]
                has_more = len(fetched) > limit
                page = fetched[:limit]
                rows = [list(r)[:-drop_tail] if drop_tail else list(r) for r in page]
            columns = list(cursor.keys())
            if drop_tail:
                columns = columns[:-drop_tail]
    except ApiError:
        if str(conn.get("driver") or "").lower() == "access":
            return _access_query(conn, text_sql, limit, offset)
        raise
    except Exception as exc:  # noqa: BLE001
        if str(conn.get("driver") or "").lower() == "access":
            return _access_query(conn, text_sql, limit, offset)
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc
    return {
        "columns": columns,
        "rows": rows,
        "rowCount": len(rows),
        "hasMore": has_more,
        "truncated": has_more,
        "paginated": paginated,
        "sql": executed,
    }


def count_query(
    conn: dict[str, Any], sql: str, password: str | None
) -> int | None:
    """统计查询总行数。

    计数失败（连接错误 / 超时 / 不支持）返回 None，不阻断预览。
    EXPLAIN/DESCRIBE 不适用，直接返回 None。
    """
    from sqlalchemy import text

    try:
        text_sql = validate_sql(sql)
    except ApiError:
        return None
    if text_sql.split()[0].lower() in ("explain", "describe"):
        return None
    count_inner = text_sql
    driver = str(conn.get("driver") or "").lower()
    # MSSQL：派生表里不能有 ORDER BY，计数前去掉最外层 ORDER BY。
    if driver == "mssql" and _has_top_level_order(text_sql, "tsql"):
        count_inner = _strip_top_level_order(text_sql, "tsql")
    try:
        engine = _engine(conn, password)
        with engine.connect() as con:
            value = con.execute(
                text(f"SELECT COUNT(*) FROM {_wrap_subquery(driver, count_inner)}")
            ).scalar()
    except Exception:  # noqa: BLE001 - 计数失败不阻断预览
        if driver == "access":
            return _access_count(conn, text_sql)
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _access_probe(conn: dict[str, Any]) -> bool:
    try:
        return access_source.probe(conn.get("path"))
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc


def _access_reflect(conn: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        return access_source.list_tables(conn.get("path"))
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc


def _access_query(
    conn: dict[str, Any], sql: str, limit: int, offset: int
) -> dict[str, Any]:
    try:
        return access_source.query(conn.get("path"), sql, limit, offset)
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc


def _access_count(conn: dict[str, Any], sql: str) -> int | None:
    try:
        return access_source.count(conn.get("path"), sql)
    except Exception:  # noqa: BLE001
        return None


_DIALECT = {
    "sqlite": "sqlite",
    "postgresql": "postgres",
    "mysql": "mysql",
    "mssql": "tsql",
    "access": "tsql",
    "oracle": "oracle",
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
    from .index import remove_schema_entries, upsert_schema_entry
    from .project import ensure_project, next_counter, save_project

    root = Path(root)
    fe = root / ".fireeye"
    schema = reflect(conn, password)
    project = ensure_project(fe, root)
    data_sources: list[dict[str, Any]] = project.setdefault("dataSources", [])
    existing = next(
        (
            ds
            for ds in data_sources
            if ds.get("type") == "db" and ds.get("connectionId") == conn["id"]
        ),
        None,
    )
    if existing is not None:
        # 同一连接重复读取：复用数据源，替换其表结构，避免产生重复数据源。
        ds_id = existing["id"]
        remove_schema_entries(fe / "index" / "schema.json", ds_id)
    else:
        ds_id = f"ds_{next_counter(fe, 'dataSource', root)}"
        existing = {
            "id": ds_id,
            "type": "db",
            "connectionId": conn["id"],
            "tables": [],
            "importedAt": None,
        }
        data_sources.append(existing)
    for entry in schema:
        upsert_schema_entry(
            fe / "index" / "schema.json",
            {
                "sourceId": ds_id,
                "connectionId": conn["id"],
                "table": entry["table"],
                "rowCount": None,
                "columns": [
                    {
                        "name": c["name"],
                        "type": c["type"],
                        "comment": c.get("comment"),
                        "sample": "",
                    }
                    for c in entry["columns"]
                ],
            },
        )
    existing["tables"] = [e["table"] for e in schema]
    save_project(fe, project)
    return {
        "sourceId": ds_id,
        "tables": [e["table"] for e in schema],
        "schema": schema,
        "authorization": authorization.get(root, conn["id"]),
    }
