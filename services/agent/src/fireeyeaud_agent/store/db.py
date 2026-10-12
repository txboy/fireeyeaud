"""数据库连接存储与连接串构造（设计 §14.9 / §14.16）。

- 元数据：`config.store(kind="db")` → `<scope>/db.json`（不含明文密码）。
- 密码：由 Electron 主进程经 `/secrets` 下发，仅内存持有（设计 §17.2）。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import quote

from ..config import store
from . import secrets

KIND = "db"
_DRIVERS = {"sqlite", "postgresql", "mysql", "mssql", "access"}


def set_secret(ref: str, password: str | None) -> None:
    if password:
        secrets.set_one(ref, password)
    else:
        secrets.remove(ref)


def get_secret(ref: str | None) -> str | None:
    return secrets.get(ref)


def list_connections(root: Path | None = None) -> list[dict[str, Any]]:
    return store.load_effective(KIND, root)


def get_connection(
    connection_id: str, scope: str, root: Path | None = None
) -> dict[str, Any] | None:
    return store.get_item(KIND, connection_id, scope, root)


def create_connection(
    data: dict[str, Any],
    *,
    password: str | None = None,
    cred_ref: str | None = None,
    root: Path | None = None,
) -> dict[str, Any]:
    from ..errors import ApiError

    driver = str(data.get("driver") or "").lower()
    if driver not in _DRIVERS:
        raise ApiError("E_DB_DRIVER", 400, "error.dbDriver", {"driver": driver})
    payload = {k: v for k, v in data.items() if k not in ("password", "credRef")}
    payload["driver"] = driver
    item = store.create_item(KIND, payload, root)
    ref = cred_ref or item["id"]
    updated = store.update_item(KIND, item["id"], item["scope"], {"credRef": ref}, root)
    if password:
        set_secret(ref, password)
    return updated


def update_connection(
    connection_id: str,
    scope: str,
    data: dict[str, Any],
    *,
    cred_ref: str | None = None,
    root: Path | None = None,
) -> dict[str, Any]:
    from ..errors import ApiError

    driver = data.get("driver")
    if driver is not None:
        driver = str(driver).lower()
        if driver not in _DRIVERS:
            raise ApiError("E_DB_DRIVER", 400, "error.dbDriver", {"driver": driver})
        data = {**data, "driver": driver}
    payload = {k: v for k, v in data.items() if k not in ("password", "credRef")}
    if cred_ref is not None:
        payload["credRef"] = cred_ref
    # drop_none=False：允许显式传 null 清空字段（如换驱动时清掉 host/port）。
    return store.update_item(
        KIND, connection_id, scope, payload, root, drop_none=False
    )


def delete_connection(connection_id: str, scope: str, root: Path | None = None) -> None:
    conn = store.get_item(KIND, connection_id, scope, root)
    store.delete_item(KIND, connection_id, scope, root)
    refs = {connection_id}
    if conn and conn.get("credRef"):
        refs.add(str(conn["credRef"]))
    for ref in refs:
        set_secret(ref, None)


def build_url(conn: dict[str, Any], password: str | None = None) -> str:
    from ..errors import ApiError

    driver = str(conn.get("driver") or "").lower()
    if driver == "sqlite":
        path = str(conn.get("path") or "").replace("\\", "/")
        return f"sqlite:///{path}"
    if driver == "access":
        path = str(conn.get("path") or "")
        return f"access+pyodbc://@/{path}"
    user = quote(str(conn.get("username") or ""), safe="")
    secret = f":{quote(password, safe='')}" if password else ""
    host = conn.get("host") or "127.0.0.1"
    port = conn.get("port")
    database = conn.get("database") or ""
    if driver == "postgresql":
        return f"postgresql+psycopg://{user}{secret}@{host}:{port or 5432}/{database}"
    if driver == "mysql":
        return f"mysql+pymysql://{user}{secret}@{host}:{port or 3306}/{database}"
    if driver == "mssql":
        driver_name = "ODBC Driver 17 for SQL Server"
        return (
            f"mssql+pyodbc://{user}{secret}@{host}:{port or 1433}/{database}"
            f"?driver={quote(driver_name)}"
        )
    raise ApiError("E_DB_DRIVER", 400, "error.dbDriver", {"driver": driver})


def find_connection_for_source(root: Path, source_id: str) -> dict[str, Any] | None:
    from .project import load_project

    project = load_project(Path(root) / ".fireeye") or {}
    for ds in project.get("dataSources", []):
        if ds.get("id") == source_id and ds.get("type") == "db":
            conn_id = ds.get("connectionId")
            for conn in list_connections(root):
                if conn.get("id") == conn_id:
                    return conn
    # 回退：sourceId 直接就是连接 id
    for conn in list_connections(root):
        if conn.get("id") == source_id:
            return conn
    return None
