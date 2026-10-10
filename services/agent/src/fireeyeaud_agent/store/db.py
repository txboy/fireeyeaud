"""数据库连接存储与连接串构造（设计 §14.9 / §14.16）。

- 元数据：`config.store(kind="db")` → `<scope>/db.json`（不含明文密码）。
- 密码：`<global_dir>/config/db_secrets.json`（keyed by connectionId）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

from ..config import store

KIND = "db"
_DRIVERS = {"sqlite", "postgresql", "mysql", "mssql", "access"}


def _secrets_path() -> Path:
    return store.global_config_dir() / "db_secrets.json"


def _load_secrets() -> dict[str, str]:
    path = _secrets_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def set_secret(connection_id: str, password: str | None) -> None:
    secrets = _load_secrets()
    if password:
        secrets[connection_id] = password
    else:
        secrets.pop(connection_id, None)
    path = _secrets_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(secrets, ensure_ascii=False, indent=2), "utf-8")


def get_secret(connection_id: str) -> str | None:
    return _load_secrets().get(connection_id)


def list_connections(root: Path | None = None) -> list[dict[str, Any]]:
    return store.load_effective(KIND, root)


def get_connection(
    connection_id: str, scope: str, root: Path | None = None
) -> dict[str, Any] | None:
    return store.get_item(KIND, connection_id, scope, root)


def create_connection(
    data: dict[str, Any], *, password: str | None, root: Path | None = None
) -> dict[str, Any]:
    from ..errors import ApiError

    driver = str(data.get("driver") or "").lower()
    if driver not in _DRIVERS:
        raise ApiError("E_DB_DRIVER", 400, "error.dbDriver", {"driver": driver})
    payload = {k: v for k, v in data.items() if k != "password"}
    payload["driver"] = driver
    item = store.create_item(KIND, payload, root)
    updated = store.update_item(
        KIND, item["id"], item["scope"], {"credRef": item["id"]}, root
    )
    if password:
        set_secret(item["id"], password)
    return updated


def delete_connection(connection_id: str, scope: str, root: Path | None = None) -> None:
    store.delete_item(KIND, connection_id, scope, root)
    set_secret(connection_id, None)


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
    return None
