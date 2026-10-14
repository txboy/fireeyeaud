# Phase 5 — 数据库连接（只读直连） Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 建议按里程碑（R→S→T→U→V）分批执行，每个里程碑结束运行一次验证并以一次提交收尾。

**Goal:** 在活动栏「数据库连接」面板配置只读数据库连接（SQLite / PostgreSQL / MySQL / SQL Server / Access），测试连通、反射表结构、勾选授权 Agent 可访问的表 / 字段；连接以数据源形式接入，Agent 经 `sql_query` 按授权范围查询。

**Architecture:** 连接元数据用现有 scope 感知配置存储 `config.store(kind="db")` → `db.json`（global/project 合并）；密码单独存于 `<global_dir>/config/db_secrets.json`（不落项目库，safeStorage 推迟）。`store/db_engine.py` 用 SQLAlchemy 统一建连、反射、执行只读查询（Access 用 `sqlalchemy-access`，缺失时降级报错）。`store/authorization.py` 维护 `.fireeye/authorization.json`（表 / 字段白名单）。`sql_query` 增 `sourceId`：命中 DB 数据源则用 `sqlglot` 解析校验表 / 列授权后经 DB 引擎执行；否则走原 DuckDB 路径。前端 `DatabasePanel` 替代 `database` 视图占位。

**Tech Stack:** Python 3.12 · FastAPI · SQLAlchemy · sqlglot · psycopg3 / pymysql / pyodbc / sqlalchemy-access · React 18 · Zustand

---

## 决策与偏差（执行前须知，2026-10-09 用户确认）

1. **驱动范围**：SQLite / PostgreSQL / MySQL / SQL Server / **Access** 五类。SQLAlchemy 统一层；Access 首选 `sqlalchemy-access`(ODBC)，失败回退纯 Python 解析(`access-parser` → 内存 SQLite)；文件上限 1G，回退实现见 `store/access_source.py`。
2. **Agent 完整集成**：DB 连接反射后注册为数据源；`describe_source` 返回 DB 表（含授权过滤）；`sql_query` 支持 `sourceId` 路由到 DB 源并强制授权。
3. **凭据存储**：**不落项目库**。密码写入 `<global_dir>/config/db_secrets.json`（本机，keyed by connectionId），`db.json` 只存 `credRef`。safeStorage 推迟 Phase 6（记为本期安全偏差）。
4. **授权粒度**：表级在 SQL 层强制（`sqlglot` 解析 `FROM/JOIN`）；字段级在 `describe_source` 层强制（Agent 看不到未授权列），SQL 层对**显式列名**做 best-effort 校验；`SELECT *` 视为取该表全部授权列。
5. **只读**：复用 `store/sandbox.validate_sql`（仅 SELECT/WITH/EXPLAIN/DESCRIBE）；SQLite 以 `mode=ro` 只读打开；查询统一包 `LIMIT`（默认 200，上限 10000）。
6. **反射时机**：`POST /db/connections/{id}/reflect` 显式触发，读取表结构与列，写 `schema.json` + `project.dataSources`；默认授权为空（拒绝一切），由用户在面板勾选。
7. **反射与查询不依赖真实外部库于测试**：单测只用 SQLite（内置）；其它驱动的 URL 构造为纯函数单测，连接受限于本地环境（人工 E2E）。

---

## 里程碑总览

| 里程碑 | 内容 | 交付 |
|---|---|---|
| R | 连接存储 + DB 引擎层 + 测试连通 REST | 连接 CRUD、`/test` |
| S | schema 反射 + 授权清单 | `/reflect`、`/authorization` |
| T | Agent 查询集成（sql_query 路由 + 授权强制 + describe_source） | Agent 可查 DB 源 |
| U | 前端数据库面板 | 活动栏「数据库连接」可用 |
| V | 端到端验收 + 文档 | 完整 Phase 5 |

---

## 里程碑 R — 连接存储 + 引擎层

### Task R1: DB 连接存储（scope 感知）+ 密码 secrets

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/config/store.py`（`_ID_PREFIX["db"] = "conn"`）
- Create: `services/agent/src/fireeyeaud_agent/store/db.py`
- Test: `services/agent/tests/test_db_store.py`

**Step 1: 改 `_ID_PREFIX`**

```python
_ID_PREFIX = {"models": "mdl", "db": "conn"}
```

**Step 2: 写失败测试**

```python
from pathlib import Path

from fireeyeaud_agent.store import db


def test_connection_crud_and_secret(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)

    conn = db.create_connection(
        {
            "name": "本地账套",
            "driver": "sqlite",
            "path": str(tmp_path / "a.db"),
            "scope": "project",
        },
        password=None,
        root=tmp_path / "ws",
    )
    assert conn["id"] == "conn_1"
    assert conn["driver"] == "sqlite"
    assert "password" not in conn
    assert conn["credRef"] == "conn_1"

    items = db.list_connections(root=tmp_path / "ws")
    assert [c["id"] for c in items] == ["conn_1"]

    db.set_secret("conn_1", "p@ss")
    assert db.get_secret("conn_1") == "p@ss"

    db.delete_connection("conn_1", "project", root=tmp_path / "ws")
    assert db.list_connections(root=tmp_path / "ws") == []


def test_url_builders():
    assert db.build_url(
        {"driver": "sqlite", "path": "C:/data/a.db"}
    ).startswith("sqlite:///")
    assert (
        db.build_url(
            {"driver": "postgresql", "host": "h", "port": 5432, "database": "d", "username": "u"}
        )
        == "postgresql+psycopg://u@h:5432/d"
    )
    assert db.build_url(
        {"driver": "mysql", "host": "h", "port": 3306, "database": "d", "username": "u"}
    ) == "mysql+pymysql://u@h:3306/d"
    assert db.build_url(
        {"driver": "mssql", "host": "h", "port": 1433, "database": "d", "username": "u"}
    ).startswith("mssql+pyodbc://u@h:1433/d")
    assert db.build_url(
        {"driver": "access", "path": "C:/data/a.accdb"}
    ).startswith("access+pyodbc://")
```

**Step 3: 运行失败** — `uv run pytest tests/test_db_store.py -v` → FAIL（`ModuleNotFoundError`）

**Step 4: 实现 `store/db.py`**

```python
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
from .project import ensure_project  # noqa: F401  (占位，避免未用告警)

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
    driver = (data.get("driver") or "").lower()
    if driver not in _DRIVERS:
        from ..errors import ApiError

        raise ApiError("E_DB_DRIVER", 400, "error.dbDriver", {"driver": driver})
    payload = {k: v for k, v in data.items() if k != "password"}
    payload["driver"] = driver
    item = store.create_item(KIND, payload, root)
    item["credRef"] = item["id"]
    store.update_item(KIND, item["id"], item["scope"], {"credRef": item["id"]}, root)
    if password:
        set_secret(item["id"], password)
    return item


def delete_connection(connection_id: str, scope: str, root: Path | None = None) -> None:
    store.delete_item(KIND, connection_id, scope, root)
    set_secret(connection_id, None)


def build_url(conn: dict[str, Any], password: str | None = None) -> str:
    driver = (conn.get("driver") or "").lower()
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
        query = f"driver={quote(driver_name)}"
        return (
            f"mssql+pyodbc://{user}{secret}@{host}:{port or 1433}/{database}?{query}"
        )
    from ..errors import ApiError

    raise ApiError("E_DB_DRIVER", 400, "error.dbDriver", {"driver": driver})
```

> `errors.py` 无需改（错误码调用处传入）；需在 zh-CN/en-US 的 `error` 增 `dbDriver` / `dbConn` / `dbUnauthorized`。

**Step 5: 运行通过** — PASS（2 passed）

**Step 6: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/config/store.py services/agent/src/fireeyeaud_agent/store/db.py services/agent/tests/test_db_store.py
git commit -m "feat(agent): 数据库连接存储与连接串构造"
```

---

### Task R2: DB 引擎层（建连 / 反射 / 只读查询）+ 连接 REST

**Files:**
- Modify: `services/agent/pyproject.toml`（`sqlalchemy`、`sqlglot`、`psycopg[binary]`、`pymysql`、`pyodbc`、`sqlalchemy-access`）
- Create: `services/agent/src/fireeyeaud_agent/store/db_engine.py`
- Create: `services/agent/src/fireeyeaud_agent/api/db.py`
- Modify: `services/agent/src/fireeyeaud_agent/main.py`
- Test: `services/agent/tests/test_db_engine.py`、`services/agent/tests/test_db_api.py`

**Step 1: 安装依赖**

Run: `cd services/agent && uv add sqlalchemy sqlglot "psycopg[binary]" pymysql pyodbc sqlalchemy-access`
Expected: 依赖写入 `pyproject.toml` / `uv.lock`（若 `sqlalchemy-access` 不可用，去掉它——Access 支持的降级见 `db_engine` 的 try/except）。

**Step 2: 写失败测试（`test_db_engine.py`）**

```python
import sqlite3
from pathlib import Path

import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store import db_engine


def _sqlite_file(tmp_path: Path) -> Path:
    path = tmp_path / "src.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE customers (id INTEGER, name TEXT, secret TEXT)")
    con.execute("INSERT INTO customers VALUES (1, '张三', 'x')")
    con.execute("INSERT INTO customers VALUES (2, '李四', 'y')")
    con.commit()
    con.close()
    return path


def test_reflect_and_query_sqlite(tmp_path):
    path = _sqlite_file(tmp_path)
    conn = {"id": "conn_1", "driver": "sqlite", "path": str(path)}

    schema = db_engine.reflect(conn, None)
    names = {t["table"] for t in schema}
    assert "customers" in names
    cols = {c["name"] for t in schema if t["table"] == "customers" for c in t["columns"]}
    assert {"id", "name", "secret"} <= cols

    result = db_engine.run_query(
        conn, "SELECT id, name FROM customers ORDER BY id", None, limit=10
    )
    assert result["columns"] == ["id", "name"]
    assert result["rows"] == [[1, "张三"], [2, "李四"]]


def test_query_rejects_write(tmp_path):
    path = _sqlite_file(tmp_path)
    conn = {"id": "conn_1", "driver": "sqlite", "path": str(path)}
    with pytest.raises(ApiError):
        db_engine.run_query(conn, "DELETE FROM customers", None)


def test_query_connection_error(tmp_path):
    conn = {"id": "conn_1", "driver": "sqlite", "path": str(tmp_path / "missing.db")}
    with pytest.raises(ApiError) as ei:
        db_engine.run_query(conn, "SELECT 1", None)
    assert ei.value.code == "E_DB_CONN"
```

**Step 3: 实现 `store/db_engine.py`**

```python
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
    if (conn.get("driver") or "").lower() == "sqlite":
        return {"connect_args": {"uri": True}}
    return {}


def _engine(conn: dict[str, Any], password: str | None):
    from sqlalchemy import create_engine

    url = build_url(conn, password)
    if (conn.get("driver") or "").lower() == "sqlite":
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
            columns = [{"name": c["name"], "type": str(c.get("type") or "")} for c in insp.get_columns(table)]
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
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
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
        truncated = len(fetched) > limit
        rows = [list(r) for r in fetched[:limit]]
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc
    return {
        "columns": columns,
        "rows": rows,
        "rowCount": len(rows),
        "truncated": truncated,
    }
```

**Step 4: 写失败测试（`test_db_api.py`）** — 覆盖连接 CRUD / test / 无工作区

```python
import sqlite3
from pathlib import Path

import httpx

from fireeyeaud_agent.main import app


def _sqlite_file(tmp_path: Path) -> Path:
    path = tmp_path / "src.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE t (id INTEGER)")
    con.commit()
    con.close()
    return path


async def test_db_connections_api(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")})
        res = await client.post(
            "/api/v1/db/connections",
            json={
                "name": "本地",
                "driver": "sqlite",
                "path": str(_sqlite_file(tmp_path)),
                "scope": "project",
            },
        )
        assert res.status_code == 200
        conn = res.json()
        assert conn["id"] == "conn_1"

        listed = (await client.get("/api/v1/db/connections")).json()["items"]
        assert [c["id"] for c in listed] == ["conn_1"]

        ok = (await client.post("/api/v1/db/connections/conn_1/test?scope=project")).json()
        assert ok["ok"] is True

        await client.delete("/api/v1/db/connections/conn_1?scope=project")
        await client.post("/api/v1/workspaces/close")


async def test_db_connections_no_workspace():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/v1/db/connections")).json()["items"] == []
```

**Step 5: 实现 `api/db.py`**

```python
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
```

`main.py`：导入 `db` 并 `app.include_router(db.router, prefix=API_PREFIX)`（放在 `export` 后）。

> 命名冲突注意：`api/db.py` 内对 `store.db` 的引用用 `from ..store import db`，端点函数名 `list_connections` / `create_connection` 不能与模块函数同名覆盖——本实现通过 `db.xxx` 前缀调用，安全。

**Step 6: 运行通过**

Run: `cd services/agent && uv run pytest tests/test_db_engine.py tests/test_db_api.py -v`
Expected: PASS

**Step 7: Commit**

```bash
git add services/agent/pyproject.toml services/agent/uv.lock services/agent/src/fireeyeaud_agent/store/db_engine.py services/agent/src/fireeyeaud_agent/api/db.py services/agent/src/fireeyeaud_agent/main.py services/agent/tests/test_db_engine.py services/agent/tests/test_db_api.py
git commit -m "feat(agent): 数据库引擎层与连接 REST"
```

---

## 里程碑 S — 反射 + 授权

### Task S1: 授权清单存储 + `/authorization` 端点

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/authorization.py`
- Modify: `services/agent/src/fireeyeaud_agent/api/db.py`
- Test: `services/agent/tests/test_authorization.py`

**Step 1: 写失败测试**

```python
from fireeyeaud_agent.store import authorization


def test_authorization_roundtrip(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    assert authorization.get(tmp_path, "conn_1") == {}
    authorization.set_entry(
        tmp_path,
        "conn_1",
        {"customers": ["id", "name"], "orders": ["*"]},
    )
    assert authorization.get(tmp_path, "conn_1") == {
        "customers": ["id", "name"],
        "orders": ["*"],
    }


def test_is_table_allowed(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    authorization.set_entry(tmp_path, "conn_1", {"customers": ["id"]})
    assert authorization.table_allowed(tmp_path, "conn_1", "customers") is True
    assert authorization.table_allowed(tmp_path, "conn_1", "orders") is False


def test_column_allowed(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    authorization.set_entry(tmp_path, "conn_1", {"customers": ["id", "name"]})
    assert authorization.column_allowed(tmp_path, "conn_1", "customers", "name") is True
    assert authorization.column_allowed(tmp_path, "conn_1", "customers", "secret") is False
    authorization.set_entry(tmp_path, "conn_1", {"customers": ["*"]})
    assert authorization.column_allowed(tmp_path, "conn_1", "customers", "secret") is True
```

**Step 2: 运行失败** — `uv run pytest tests/test_authorization.py -v` → FAIL

**Step 3: 实现 `store/authorization.py`**

```python
"""数据库表 / 字段授权清单（设计 §14.9）。落盘 `.fireeye/authorization.json`。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_AUTHZ = "authorization.json"


def _path(root: Path) -> Path:
    return Path(root) / ".fireeye" / _AUTHZ


def _load(root: Path) -> dict[str, Any]:
    path = _path(root)
    if not path.exists():
        return {"connections": {}}
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"connections": {}}
    data.setdefault("connections", {})
    return data


def _save(root: Path, data: dict[str, Any]) -> None:
    path = _path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")


def get(root: Path, connection_id: str) -> dict[str, list[str]]:
    return _load(root)["connections"].get(connection_id, {})


def set_entry(root: Path, connection_id: str, tables: dict[str, list[str]]) -> None:
    data = _load(root)
    data["connections"][connection_id] = tables
    _save(root, data)


def table_allowed(root: Path, connection_id: str, table: str) -> bool:
    return table in get(root, connection_id)


def column_allowed(
    root: Path, connection_id: str, table: str, column: str
) -> bool:
    cols = get(root, connection_id).get(table)
    if cols is None:
        return False
    return "*" in cols or column in cols
```

**Step 4: `api/db.py` 增 `PATCH /db/connections/{id}/authorization`**

```python
class AuthorizationBody(BaseModel):
    tables: dict[str, list[str]]


@router.patch("/db/connections/{connection_id}/authorization")
def set_authorization(connection_id: str, body: AuthorizationBody) -> dict:
    root = workspace_manager.root
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    from ..store import authorization

    authorization.set_entry(root, connection_id, body.tables)
    return {"ok": True, "tables": body.tables}
```

**Step 5: 运行通过** — `uv run pytest tests/test_authorization.py -v` → PASS

**Step 6: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/authorization.py services/agent/src/fireeyeaud_agent/api/db.py services/agent/tests/test_authorization.py
git commit -m "feat(agent): 数据库表/字段授权清单"
```

---

### Task S2: `/reflect` 反射并注册数据源

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/index.py`（`upsert_schema_entry` 去重键改为 `(sourceId, table)`）
- Modify: `services/agent/src/fireeyeaud_agent/api/db.py`
- Test: `services/agent/tests/test_db_reflect_api.py`

> **已核对**：`schema.json` 是**顶层数组** `[{sourceId, table, rowCount, columns:[{name,type,sample}]}]`；
> `upsert_schema_entry` 现按 `table` 去重——DB 表名可能与文件表重名，需改为按 `(sourceId, table)` 去重
> （文件表名 `src_dsN_*` 全局唯一，改动对既有行为安全）。

**Step 1: 写失败测试**

```python
import sqlite3
from pathlib import Path

import httpx

from fireeyeaud_agent.main import app


def _sqlite_file(tmp_path: Path) -> Path:
    path = tmp_path / "src.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE customers (id INTEGER, name TEXT)")
    con.commit()
    con.close()
    return path


async def test_reflect_registers_datasource_and_schema(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")})
        conn = (
            await client.post(
                "/api/v1/db/connections",
                json={
                    "name": "本地",
                    "driver": "sqlite",
                    "path": str(_sqlite_file(tmp_path)),
                    "scope": "project",
                },
            )
        ).json()
        res = await client.post(
            f"/api/v1/db/connections/{conn['id']}/reflect?scope=project"
        )
        assert res.status_code == 200
        body = res.json()
        assert body["sourceId"].startswith("ds_")
        assert body["tables"] == ["customers"]
        await client.post("/api/v1/workspaces/close")
```

**Step 2: 运行失败** — FAIL（404）

**Step 3: 实现 `POST /db/connections/{id}/reflect`**

先改 `store/index.py`：

```python
def upsert_schema_entry(path: Path, entry: dict[str, Any]) -> None:
    entries = [
        e
        for e in load_schema(path)
        if (e.get("sourceId"), e.get("table"))
        != (entry.get("sourceId"), entry.get("table"))
    ]
    entries.append(entry)
    save_schema(path, entries)
```

在 `api/db.py` 追加（写库逻辑放 `store/db_engine.py` 的 `reflect_and_register`）：

```python
# store/db_engine.py 追加
def reflect_and_register(
    root, conn: dict, password: str | None
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
    # 默认授权空（拒绝一切）
    existing = authorization.get(root, conn["id"])
    return {"sourceId": ds_id, "tables": [e["table"] for e in schema], "authorization": existing}
```

`api/db.py`：

```python
@router.post("/db/connections/{connection_id}/reflect")
def reflect_connection(connection_id: str, scope: str = Query(default="global")) -> dict:
    root = workspace_manager.root
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    conn = db.get_connection(connection_id, scope, root)
    if conn is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": connection_id})
    return db_engine.reflect_and_register(root, conn, db.get_secret(connection_id))
```

> `store/index.py` 的 `upsert_schema_entry` 已在上一步改为按 `(sourceId, table)` 去重；DB 条目
> 额外带 `connectionId` 字段，其余按数组项透传即可。

**Step 4: 运行通过** — PASS

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/api/db.py services/agent/src/fireeyeaud_agent/store/db_engine.py services/agent/tests/test_db_reflect_api.py
git commit -m "feat(agent): 数据库表结构反射并注册数据源"
```

---

## 里程碑 T — Agent 查询集成

### Task T1: `sql_query` 路由到 DB 源 + 授权强制

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/tools/sql_query.py`
- Modify: `services/agent/src/fireeyeaud_agent/tools/registry.py`（`sql_query` 参数增 `sourceId`）
- Test: `services/agent/tests/test_sql_query_db.py`

**Step 1: 写失败测试**

```python
import sqlite3
from pathlib import Path

import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store import authorization, db
from fireeyeaud_agent.tools.sql_query import sql_query


def _seed(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    path = tmp_path / "src.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE customers (id INTEGER, name TEXT, secret TEXT)")
    con.execute("INSERT INTO customers VALUES (1, 'a', 's')")
    con.commit()
    con.close()
    conn = db.create_connection(
        {"name": "n", "driver": "sqlite", "path": str(path), "scope": "project"},
        password=None,
        root=tmp_path / "ws",
    )
    return tmp_path / "ws", conn


def test_sql_query_routes_to_db_with_authorization(tmp_path, monkeypatch):
    ws, conn = _seed(tmp_path, monkeypatch)
    authorization.set_entry(ws, conn["id"], {"customers": ["id", "name"]})
    result = sql_query(ws, {"sql": "SELECT id, name FROM customers", "sourceId": conn["id"]})
    assert result["rows"] == [[1, "a"]]


def test_sql_query_denies_unauthorized_table(tmp_path, monkeypatch):
    ws, conn = _seed(tmp_path, monkeypatch)
    authorization.set_entry(ws, conn["id"], {"customers": ["id"]})
    with pytest.raises(ApiError) as ei:
        sql_query(ws, {"sql": "SELECT * FROM orders", "sourceId": conn["id"]})
    assert ei.value.code == "E_DB_UNAUTHORIZED"


def test_sql_query_denies_unauthorized_column(tmp_path, monkeypatch):
    ws, conn = _seed(tmp_path, monkeypatch)
    authorization.set_entry(ws, conn["id"], {"customers": ["id", "name"]})
    with pytest.raises(ApiError) as ei:
        sql_query(ws, {"sql": "SELECT secret FROM customers", "sourceId": conn["id"]})
    assert ei.value.code == "E_DB_UNAUTHORIZED"


def test_sql_query_denies_missing_source(tmp_path, monkeypatch):
    ws, _ = _seed(tmp_path, monkeypatch)
    with pytest.raises(ApiError) as ei:
        sql_query(ws, {"sql": "SELECT 1", "sourceId": "conn_999"})
    assert ei.value.code == "E_DB_UNAUTHORIZED"
```

**Step 2: 运行失败**

Run: `cd services/agent && uv run pytest tests/test_sql_query_db.py -v`
Expected: FAIL

**Step 3: 实现**

`store/db_engine.py` 追加授权校验：

```python
def check_authorization(root, connection_id: str, sql: str, dialect: str) -> None:
    import sqlglot
    from sqlglot import exp

    from ..errors import ApiError
    from . import authorization

    allowed = authorization.get(root, connection_id)
    try:
        tree = sqlglot.parse_one(sql, read=dialect)
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_DB_UNAUTHORIZED", 403, "error.dbUnauthorized", {"reason": "parse"}) from exc
    tables = {t.name for t in tree.find_all(exp.Table)}
    for table in tables:
        if table not in allowed:
            raise ApiError("E_DB_UNAUTHORIZED", 403, "error.dbUnauthorized", {"table": table})
    for col in tree.find_all(exp.Column):
        name = col.name
        if name == "*" or not name:
            continue
        qualified = col.table
        if qualified and qualified in allowed:
            if not authorization.column_allowed(root, connection_id, qualified, name):
                raise ApiError("E_DB_UNAUTHORIZED", 403, "error.dbUnauthorized", {"column": name})
            continue
        # 未限定列：若所有授权表中均无此列 → 拒绝（best-effort）
        if not any(
            authorization.column_allowed(root, connection_id, t, name)
            for t in allowed
        ):
            raise ApiError("E_DB_UNAUTHORIZED", 403, "error.dbUnauthorized", {"column": name})
```

`tools/sql_query.py` 在 `sql_query` 顶部增 DB 路由分支。

在 `store/db.py` 追加（供 tools 用，避免 tools 依赖 api）：

```python
def find_connection_for_source(root, source_id: str) -> dict[str, Any] | None:
    from .project import load_project

    project = load_project(Path(root) / ".fireeye") or {}
    for ds in project.get("dataSources", []):
        if ds.get("id") == source_id and ds.get("type") == "db":
            conn_id = ds.get("connectionId")
            for conn in list_connections(root):
                if conn.get("id") == conn_id:
                    return conn
    return None
```

`tools/sql_query.py`：

```python
def sql_query(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    source_id = params.get("sourceId")
    if source_id:
        from ..errors import ApiError
        from ..store import db, db_engine

        root = Path(root)
        conn = db.find_connection_for_source(root, source_id)
        if conn is None:
            raise ApiError(
                "E_DB_UNAUTHORIZED", 403, "error.dbUnauthorized", {"source": source_id}
            )
        dialect = {"sqlite": "sqlite", "postgresql": "postgres", "mysql": "mysql",
                   "mssql": "tsql", "access": "tsql"}.get(conn.get("driver"), "sqlite")
        db_engine.check_authorization(root, conn["id"], params.get("sql", ""), dialect)
        return db_engine.run_query(
            conn, params.get("sql", ""), db.get_secret(conn["id"]),
            limit=int(params.get("limit") or 200),
        )
    # ... 原 DuckDB 分支不变
```

`tools/registry.py`：`sql_query` 的 schema 增可选 `sourceId: {"type": "string", "description": "数据库数据源 id；缺省查询工作区 DuckDB"}`。

**Step 4: 运行通过** — `uv run pytest tests/test_sql_query_db.py -v` → PASS

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/tools/sql_query.py services/agent/src/fireeyeaud_agent/tools/registry.py services/agent/src/fireeyeaud_agent/store/db.py services/agent/src/fireeyeaud_agent/store/db_engine.py services/agent/tests/test_sql_query_db.py
git commit -m "feat(agent): sql_query 支持按授权查询数据库源"
```

---

### Task T2: `describe_source` 返回 DB 源（授权列过滤）

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/tools/describe_source.py`
- Test: `services/agent/tests/test_describe_source_db.py`

**Step 1: 写失败测试**

```python
import json

from fireeyeaud_agent.store import authorization
from fireeyeaud_agent.tools.describe_source import describe_source


def test_describe_source_filters_db_columns(tmp_path):
    fe = tmp_path / ".fireeye"
    (fe / "index").mkdir(parents=True)
    (fe / "index" / "schema.json").write_text(
        json.dumps(
            [
                {
                    "sourceId": "ds_1",
                    "connectionId": "conn_1",
                    "table": "customers",
                    "rowCount": None,
                    "columns": [
                        {"name": "id", "type": "INTEGER", "sample": ""},
                        {"name": "secret", "type": "TEXT", "sample": ""},
                    ],
                }
            ]
        ),
        "utf-8",
    )
    authorization.set_entry(tmp_path, "conn_1", {"customers": ["id"]})
    result = describe_source(tmp_path, {"sourceId": "ds_1"})
    cols = {c["name"] for t in result["tables"] for c in t["columns"]}
    assert cols == {"id"}
```

> `schema.json` 为顶层数组（已核对 `store/index.py`）。

**Step 2: 运行失败** — FAIL

**Step 3: 实现**：在 `describe_source` 汇总后，对含 `connectionId` 的表按其授权列过滤（无授权 → 该表整体隐藏）。

**Step 4: 运行通过** — PASS

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/tools/describe_source.py services/agent/tests/test_describe_source_db.py
git commit -m "feat(agent): describe_source 过滤未授权数据库列"
```

---

## 里程碑 U — 前端数据库面板

### Task U1: 类型 + API + store + i18n

**Files:**
- Modify: `packages/shared/src/types.ts`（`DbDriver` / `DbConnection`）
- Modify: `apps/renderer/src/lib/api.ts`（连接 CRUD / test / reflect / authorization）
- Create: `apps/renderer/src/store/database.ts`
- Modify: `packages/shared/src/locales/{zh-CN,en-US}.ts`（`database` 扩充 + `error.db*` + `enums.driver`）

**Step 1: 类型**

```ts
export type DbDriver = 'sqlite' | 'postgresql' | 'mysql' | 'mssql' | 'access';

export interface DbConnection {
  id: string;
  name: string;
  driver: DbDriver;
  scope: ConfigScope;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  path?: string | null;
  credRef?: string;
}

export interface DbColumn { name: string; type: string; }
export interface DbTableSchema { table: string; columns: DbColumn[]; }
```

**Step 2: API（`lib/api.ts`）**

```ts
export function listDbConnections(scope?: ConfigScope): Promise<{ items: DbConnection[] }> { ... }
export function createDbConnection(input: DbConnectionInput): Promise<DbConnection> { ... }
export function deleteDbConnection(id: string, scope: ConfigScope): Promise<{ ok: boolean }> { ... }
export function testDbConnection(id: string, scope: ConfigScope): Promise<{ ok: boolean }> { ... }
export function reflectDbConnection(id: string, scope: ConfigScope): Promise<{ sourceId: string; tables: string[]; authorization: Record<string, string[]> }> { ... }
export function setDbAuthorization(id: string, tables: Record<string, string[]>): Promise<{ ok: boolean }> { ... }
```

**Step 3: store（`store/database.ts`）**：`items/loading/busy/errorKey` + `load/create/remove/test/reflect/setAuthorization`，风格同 `store/rules.ts`。

**Step 4: i18n**

`database`（zh-CN；en-US 对应英文）：`addConnection`（已有）、`empty`（已有）、`name`、`driver`、`host`、`port`、`database`、`username`、`password`、`path`、`scope`、`test`、`testOk`、`reflect`、`authorized`、`tables`、`save`、`connect`、`selectAll`、`columns`。
`enums.driver`：`{ sqlite: 'SQLite', postgresql: 'PostgreSQL', mysql: 'MySQL', mssql: 'SQL Server', access: 'Access' }`。
`error`：`dbDriver`、`dbConn`、`dbUnauthorized`。

**Step 5: 验证** — `npm run renderer:typecheck`

**Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/locales/zh-CN.ts packages/shared/src/locales/en-US.ts apps/renderer/src/lib/api.ts apps/renderer/src/store/database.ts
git commit -m "feat(renderer): 数据库连接类型、API 与 store"
```

---

### Task U2: DatabasePanel + SideBar 接入

**Files:**
- Create: `apps/renderer/src/components/panels/DatabasePanel.tsx`
- Modify: `apps/renderer/src/components/SideBar.tsx`（`case 'database'` → `<DatabasePanel />`）
- Modify: `apps/renderer/src/styles/global.css`

**Step 1: 实现 `DatabasePanel.tsx`**

要点：
- `useEffect(load, [load, path])`。
- 顶部「新建连接」按钮 → 简易内联表单（name / driver 下拉 / 依 driver 显示 host/port/database/username/password 或 path / scope 单选）。提交调 `create`。
- 连接列表：每项显示 name / driver（`enums.driver.*`）/ `ScopeBadge`；操作：测试连通、反射表结构、删除。
- 反射后展示表列表 + 每表可勾选授权（表级 checkbox；展开可勾选列，勾「全选」= `["*"]`）。保存调 `setAuthorization`。
- 无工作区 → `common:noWorkspace`；空列表 → `empty`；错误 → `error.*`。

参考骨架：

```tsx
export function DatabasePanel() {
  const { t } = useTranslation('database');
  const { t: te } = useTranslation('enums');
  const items = useDatabaseStore((s) => s.items);
  const load = useDatabaseStore((s) => s.load);
  const test = useDatabaseStore((s) => s.test);
  const reflect = useDatabaseStore((s) => s.reflect);
  const remove = useDatabaseStore((s) => s.remove);
  const create = useDatabaseStore((s) => s.create);
  const path = useWorkspaceStore((s) => s.path);
  // 表单 state + 反射结果 state ...
  // ...
}
```

**Step 2: `SideBar.tsx`** 接入：

```tsx
import { DatabasePanel } from './panels/DatabasePanel';
...
    case 'database':
      return <DatabasePanel />;
```

**Step 3: CSS**：`.db-form`、`.db-table`、`.db-col`（沿用现有 `card` / `searchbox` / `button` 类，最小新增）。

**Step 4: 验证**

Run: `npm run renderer:typecheck && npm run renderer:build && npm run desktop:test`
Expected: 全部通过

**Step 5: Commit**

```bash
git add apps/renderer/src/components/panels/DatabasePanel.tsx apps/renderer/src/components/SideBar.tsx apps/renderer/src/styles/global.css
git commit -m "feat(renderer): 数据库连接面板（配置/测试/反射/授权）"
```

---

## 里程碑 V — 端到端验收

### Task V1: 验收与文档

**Step 1: 后端全量测试** — `cd services/agent && uv run pytest` → 全绿。

**Step 2: 前端检查** — `npm run renderer:typecheck && npm run renderer:build && npm run desktop:test` → 全绿。

**Step 3: 手动 E2E（SQLite 可闭环；其它驱动视本地环境）**

1. `npm run desktop:dev`；打开工作区；活动栏「数据库连接」新建 SQLite 连接（选 `.db` 文件）；
2. 「测试连通」→ 成功；「反射表结构」→ 出现表列表；
3. 勾选某表与部分列并保存；
4. 对话让 Agent「查询 <表> 的 <列>」→ Agent 经 `sql_query({sourceId})` 返回数据；请求未授权表/列 → `error.dbUnauthorized`；
5. 有 PostgreSQL/MySQL/SQL Server/Access 环境时重复连接测试。

**Step 4: 更新 README / 计划文档偏差**

README 状态段追加 Phase 5；本计划末尾追加「Phase 5 实现记录」。

**Step 5: Commit**

```bash
git add -A
git commit -m "docs: Phase 5 验收记录与偏差说明"
```

---

## 风险与注意事项

- **驱动缺失**：环境未装 ODBC / Access 驱动时，`create_engine` 或查询阶段抛错；Access 会自动回退到纯 Python 解析(`access-parser` → 内存 SQLite)，其余驱动统一转 `E_DB_CONN`（502），不崩溃。
- **明文密码**：`db_secrets.json` 为明文（本机 `~/.fireeye/config/`）；safeStorage 推迟 Phase 6——安全偏差，README 标注。
- **sqlglot 方言**：`access`/`mssql` 统一按 `tsql` 解析；解析失败 → `E_DB_UNAUTHORIZED`（拒绝而非放行）。
- **字段级授权为 best-effort**：`SELECT *` 仅返回该表授权列（依赖 DB 引擎本身不做列裁剪——本实现**引用 `*` 时不裁剪返回列**，属已知偏差；严格列裁剪推迟）。
- **只读**：SQLite 以 `mode=ro` + `uri=true` 打开；PG/MySQL/MSSQL/Access 依赖 `validate_sql` 只读白名单，非数据库侧强制。
- **schema.json**：顶层数组；`upsert_schema_entry` 去重键改为 `(sourceId, table)`（已核对 `store/index.py`）。
- **连接串特殊字符**：用户名 / 密码做 URL 编码；`#` 等留在库名中需注意（本期接受）。
- **计数并发**：`dataSource` 计数走 `next_counter`（非原子）；本地单用户接受。

---

## Phase 5 实现记录（2026-10-09 完成）

里程碑 R–U 均已完成并逐任务提交：

- **R 连接存储 + 引擎层**：`store/db.py`（连接 scope 感知 CRUD + `db_secrets.json` + URL 构造）、
  依赖 `sqlalchemy`/`sqlglot`/`psycopg`/`pymysql`/`pyodbc`/`sqlalchemy-access`、
  `store/db_engine.py`（建连 / 反射 / 只读查询 / `check_authorization`）、
  `api/db.py`（连接 CRUD + `/test`）。
- **S 反射 + 授权**：`store/authorization.py`（`.fireeye/authorization.json`）、
  `PATCH /db/connections/{id}/authorization`、`POST /db/connections/{id}/reflect`
  （写 `schema.json` + 注册 `dataSource`）；`upsert_schema_entry` 去重键改为 `(sourceId, table)`。
- **T Agent 查询集成**：`sql_query` 增 `sourceId` 路由（sqlglot 校验表 / 显式列授权，
  连接 id 回退）；`describe_source` 对 DB 源按授权过滤表 / 列。
- **U 前端**：类型 / API / `store/database.ts` / i18n（`database`、`enums.driver`、`error.db*`）；
  `DatabasePanel`（新建连接 / 测试连通 / 读取表结构 / 表与列授权勾选）接入活动栏 `database` 视图。

**验证：** 后端 `uv run pytest` → 116 passed（较 Phase 4 的 98 增 18）；`renderer:typecheck` /
`renderer:build` / `desktop:test`（2 pass）均通过。非 SQLite 引擎与真实 GUI 流程需按 V1 Step 3 人工验证。

**实现期间的说明：**

1. `reflect` 响应额外返回 `schema`（表 + 列），供前端授权界面展示列级勾选（计划原只返回表名）。
2. `find_connection_for_source` 支持 `sourceId` 既可为数据源 id，也可直接为连接 id（回退）。
3. `errors.py` 仍无需改动；DB 相关错误码 `E_DB_DRIVER` / `E_DB_CONN` / `E_DB_UNAUTHORIZED` + messageKey 就近传入。
4. 新增依赖后首次启动 sidecar 会因字节码冷编译超 30s 健康检查超时（预热后约 7s 通过）——非回归。
5. 单一测试环境下仅 SQLite 可真实闭环；PG/MySQL/MSSQL/Access 依赖本地驱动 / 服务，未自动验证。

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-10-09-phase5-database-connections.md`. Two execution options:

**1. Subagent-Driven (this session)** — 每个 Task 派发新的 subagent，任务间审查（REQUIRED SUB-SKILL: superpowers:subagent-driven-development）。

**2. Parallel Session (separate)** — 新会话用 executing-plans（REQUIRED SUB-SKILL: superpowers:executing-plans）。

Which approach?
