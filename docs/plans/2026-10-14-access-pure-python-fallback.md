# Access 纯 Python 回退 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让数据库连接里的 Access(`.mdb`/`.accdb`)在系统 ODBC/ACE 不可用时，自动回退到纯 Python 解析（`access-parser`），无需 ODBC 驱动、无需 JVM。

**Architecture:** 保留现有 `sqlalchemy-access`(ODBC) 为首选路径；当它失败时，用 `access-parser` 读取 Access 文件的表与数据，物化到进程内内存 SQLite（stdlib `sqlite3`，按 `(path, mtime_ns, size)` 缓存），再由 `db_engine` 复用只读查询/反射链路。授权与 SQL 只读校验仍按 Access 方言(现为 `tsql`)；实际执行前用已有的 `sqlglot` 把 SQL 转译到 SQLite。

**Tech Stack:** Python 3.12、FastAPI sidecar、SQLAlchemy、sqlglot、stdlib sqlite3、`access-parser`(纯 Python)。

---

## 决策（已与用户确认，2026-10-14）

1. 只上 `access-parser`；以后确有需要再 vendor `refinery` 的解析器。
2. Access 文件大小上限 **1G**（超过则报 `E_DB_CONN`，不尝试解析）。
3. 反射拿不到真实主键可接受（`primaryKey` 全 `false` 亦可）。
4. **保留 `sqlalchemy-access` 为首选**，仅在其失败时启用 `access-parser` 回退。
5. 本计划文件写入 `docs/plans/`。

### 关键前提 / 风险（务必知晓）

- 实测本机：**一旦真正加载 ODBC/ACE 驱动，进程会被直接终止（退出码 -3），不抛异常**，回退代码无机会执行。
  当前 `store/db.py::build_url` 对 access 生成的是 `access+pyodbc://@/<path>`，`sqlalchemy-access` 会套用驱动名 `"Microsoft Access"`（系统不存在）→ 干净地报 `IM002` → **正好触发回退**。
  因此本计划**不改 `build_url` 的驱动名**。若将来把驱动名改成真实驱动，本机将崩溃且无法回退。
- 只读、仅表：读不到 Access 保存的查询(视图)、表关系、加密库。
- `access-parser` 会整库读入内存；靠 1G 上限 + LRU 缓存控制。
- 空表（无数据页）可能拿不到列，反射时会缺失（可接受）。

---

## Task 1: 引入 `access-parser` 依赖

**Files:**
- Modify: `services/agent/pyproject.toml`

**Step 1: 加依赖**

在 `[project].dependencies` 列表末尾（`"httpx>=0.28.1",` 之后）加一行：

```toml
  "access-parser>=0.0.6",
```

> 注意：**不要**移除 `sqlalchemy-access`（决策 4）。

**Step 2: 同步依赖**

Run（工作目录 `E:\fireeyeaud\services\agent`）：
```powershell
uv sync
```
Expected: 安装成功，`uv.lock` 更新。

**Step 3: 验证可导入**

Run:
```powershell
.\.venv\Scripts\python.exe -c "from access_parser import AccessParser; print('ok')"
```
Expected: 输出 `ok`。若因 sdist 编译失败，安装构建工具后重试（需 setuptools）。

**Step 4: Commit**

```powershell
git add services/agent/pyproject.toml services/agent/uv.lock
git commit -m "deps(agent): add pure-python access-parser for Access fallback"
```

---

## Task 2: 新增 `access_source` 模块（解析 + 物化 SQLite）

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/access_source.py`
- Test: `services/agent/tests/test_access_source.py`

**Step 1: 写失败测试**

创建 `services/agent/tests/test_access_source.py`：

```python
import sqlite3
from pathlib import Path

import pytest

from fireeyeaud_agent.store import access_source


@pytest.fixture(scope="module")
def sample_mdb() -> Path:
    # 见“测试夹具”说明：放在 tests/fixtures/access_sample.mdb
    p = Path(__file__).parent / "fixtures" / "access_sample.mdb"
    if not p.exists():
        pytest.skip("access fixture missing")
    return p


def test_load_materializes_tables(sample_mdb):
    con = access_source._get(sample_mdb)
    names = {
        r[0]
        for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert {"users", "orders"} <= names

    rows = con.execute("SELECT name FROM users ORDER BY id").fetchall()
    assert [r[0] for r in rows] == ["Alice", "Bob", "Charlie", "Diana", "Eve"]

    cnt = con.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
    assert cnt == 5


def test_load_caches_same_connection(sample_mdb):
    a = access_source._get(sample_mdb)
    b = access_source._get(sample_mdb)
    assert a is b


def test_missing_file_raises(sample_mdb, tmp_path):
    with pytest.raises(FileNotFoundError):
        access_source._get(tmp_path / "nope.mdb")
```

**Step 2: 运行测试确认失败**

Run（`services/agent`）：
```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_access_source.py -q
```
Expected: FAIL（`ModuleNotFoundError: access_source`）——先跑到“模块不存在”即可。

**Step 3: 写实现**

创建 `services/agent/src/fireeyeaud_agent/store/access_source.py`：

```python
"""Access 文件解析回退（纯 Python，无 ODBC / ACE / JVM 依赖）。

当 ``sqlalchemy-access``（ODBC）不可用时，用 ``access-parser`` 读取
``.mdb`` / ``.accdb`` 的表与数据，物化到进程内内存 SQLite，
供 ``db_engine`` 复用只读查询与反射链路。

- 只读、仅表（不读保存的查询 / 关系 / 加密）。
- 按 (path, mtime_ns, size) 缓存；文件上限 1G。
"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Any

MAX_FILE_BYTES = 1024 * 1024 * 1024  # 1G
_CACHE_LIMIT = 4

_lock = threading.Lock()
_cache: dict[tuple, sqlite3.Connection] = {}
_cache_order: list[tuple] = []


def _cache_key(path: Path) -> tuple:
    st = path.stat()
    return (str(path.resolve()), st.st_mtime_ns, st.st_size)


def _quote(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def _to_sqlite_type(values: list) -> str:
    seen = [v for v in values if v is not None]
    if not seen:
        return "TEXT"
    if all(isinstance(v, bool) for v in seen):
        return "INTEGER"
    if all(isinstance(v, int) and not isinstance(v, bool) for v in seen):
        return "INTEGER"
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in seen):
        return "REAL"
    if all(isinstance(v, (bytes, bytearray)) for v in seen):
        return "BLOB"
    return "TEXT"


def _coerce(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float, str, bytes, bytearray)):
        return value
    # date / datetime / Decimal / UUID 等 → 文本（只读展示足够）
    return str(value)


def _load(path: Path) -> sqlite3.Connection:
    from access_parser import AccessParser

    parser = AccessParser(str(path))
    con = sqlite3.connect(":memory:", check_same_thread=False)
    for table in list(parser.catalog):
        data = parser.parse_table(table)
        if not data:
            continue  # 无数据 / 无列信息，跳过
        cols = list(data.keys())
        col_types = [_to_sqlite_type(data[c]) for c in cols]
        col_defs = ", ".join(
            f"{_quote(c)} {t}" for c, t in zip(cols, col_types)
        )
        con.execute(f"CREATE TABLE {_quote(table)} ({col_defs})")
        ncols = len(cols)
        nrows = max((len(data[c]) for c in cols), default=0)
        if nrows:
            placeholders = ", ".join("?" * ncols)
            rows = [
                tuple(
                    _coerce(data[c][i]) if i < len(data[c]) else None
                    for c in cols
                )
                for i in range(nrows)
            ]
            con.executemany(
                f"INSERT INTO {_quote(table)} VALUES ({placeholders})", rows
            )
    con.commit()
    return con


def _get(path) -> sqlite3.Connection:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(str(path))
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("access file exceeds 1G limit")
    key = _cache_key(path)
    with _lock:
        if key in _cache:
            return _cache[key]
    con = _load(path)
    with _lock:
        _cache[key] = con
        _cache_order.append(key)
        while len(_cache_order) > _CACHE_LIMIT:
            old = _cache_order.pop(0)
            if old in _cache:
                _cache.pop(old).close()
    return con
```

**Step 4: 运行测试确认通过**

先放好夹具（见 Task 3 的“测试夹具”章节），再：
```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_access_source.py -q
```
Expected: PASS。

**Step 5: Commit**

```powershell
git add services/agent/src/fireeyeaud_agent/store/access_source.py services/agent/tests/test_access_source.py
git commit -m "feat(agent): access_source loads .mdb/.accdb into in-memory sqlite"
```

---

## Task 3: 测试夹具（真实 `.mdb` / `.accdb`）

**Files:**
- Create: `services/agent/tests/fixtures/access_sample.mdb`
- Create: `services/agent/tests/fixtures/access_sample.accdb`（可选）

**Step 1: 放入 `.mdb` 夹具**

把本机已生成的样例复制进仓库：
```powershell
New-Item -ItemType Directory -Force E:\fireeyeaud\services\agent\tests\fixtures | Out-Null
Copy-Item D:\tmp\test_access.mdb E:\fireeyeaud\services\agent\tests\fixtures\access_sample.mdb -Force
```
样例结构：`users(id,name,email,age,created)` 5 行、`orders(id,user_id,product,amount,order_date)` 5 行。

**Step 2: 放一个 `.accdb` 夹具（若手头有）**

从公开样例下载或用户提供一个 `.accdb`，放到
`services/agent/tests/fixtures/access_sample.accdb`。

> 本机无法用 ACE 生成 `.accdb`。若暂时没有，先在 accdb 相关测试里 `pytest.skip`。

**Step 3: 确认夹具被 pytest 收集**

Run:
```powershell
.\.venv\Scripts\python.exe -c "from access_parser import AccessParser; db=AccessParser(r'tests\fixtures\access_sample.mdb'); print(list(db.catalog))"
```
Expected: 打印出包含 `users`、`orders` 的列表。

**Step 4: Commit**

```powershell
git add services/agent/tests/fixtures
git commit -m "test(agent): add access .mdb fixture"
```

---

## Task 4: `access_source` 公共 API（probe / list_tables / query / count）

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/access_source.py`
- Test: `services/agent/tests/test_access_source.py`

**Step 1: 追加失败测试**

在 `test_access_source.py` 末尾追加：

```python
def test_probe(sample_mdb):
    assert access_source.probe(sample_mdb) is True


def test_list_tables(sample_mdb):
    schema = access_source.list_tables(sample_mdb)
    names = {t["table"] for t in schema}
    assert {"users", "orders"} <= names
    users = next(t for t in schema if t["table"] == "users")
    cols = {c["name"] for c in users["columns"]}
    assert {"id", "name", "email", "age", "created"} <= cols
    assert all(set(c) == {"name", "type", "comment", "nullable", "primaryKey"}
               for c in users["columns"])


def test_query_paginates(sample_mdb):
    result = access_source.query(
        sample_mdb, "SELECT id, name FROM users ORDER BY id", 2, 0
    )
    assert result["columns"] == ["id", "name"]
    assert result["rows"] == [[1, "Alice"], [2, "Bob"]]
    assert result["hasMore"] is True
    assert result["paginated"] is True

    page2 = access_source.query(
        sample_mdb, "SELECT id, name FROM users ORDER BY id", 2, 2
    )
    assert page2["rows"] == [[3, "Charlie"], [4, "Diana"]]


def test_query_translates_access_syntax(sample_mdb):
    # 方括号标识符 + TOP（Access 方言）应能转译并在 sqlite 上执行
    result = access_source.query(
        sample_mdb, "SELECT TOP 2 [id] FROM [users] ORDER BY [id]", 10, 0
    )
    assert result["rows"] == [[1], [2]]


def test_query_user_limit_not_paginated(sample_mdb):
    result = access_source.query(
        sample_mdb, "SELECT id FROM users ORDER BY id LIMIT 2", 5, 0
    )
    assert result["paginated"] is False
    assert result["rows"] == [[1], [2]]


def test_count(sample_mdb):
    assert access_source.count(sample_mdb, "SELECT id FROM users") == 5
    assert access_source.count(sample_mdb, "SELECT id FROM users WHERE id > 3") == 2


def test_size_limit(monkeypatch, tmp_path):
    p = tmp_path / "big.mdb"
    p.write_bytes(b"\x00" * 16)
    monkeypatch.setattr(access_source, "MAX_FILE_BYTES", 8)
    with pytest.raises(ValueError):
        access_source._get(p)
```

**Step 2: 运行确认失败**

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_access_source.py -q
```
Expected: FAIL（`probe` / `list_tables` / `query` / `count` 未定义）。

**Step 3: 实现公共 API**

在 `access_source.py` 末尾追加：

```python
from .sandbox import validate_sql  # 顶部 import 区


def _transpile(sql: str) -> str:
    """把 Access(按 tsql 读) SQL 转成 SQLite；失败则原样返回。"""
    try:
        import sqlglot

        out = sqlglot.transpile(sql, read="tsql", write="sqlite")
        if out:
            return out[0]
    except Exception:  # noqa: BLE001
        pass
    return sql


def probe(path) -> bool:
    with open_db(path) as con:
        con.execute("SELECT 1")
    return True


def list_tables(path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with open_db(path) as con:
        for (name,) in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall():
            info = con.execute(f"PRAGMA table_info({_quote(name)})").fetchall()
            # PRAGMA table_info: cid, name, type, notnull, dflt_value, pk
            columns = [
                {
                    "name": r[1],
                    "type": r[2] or "TEXT",
                    "comment": None,
                    "nullable": not bool(r[3]),
                    "primaryKey": bool(r[5]),
                }
                for r in info
            ]
            out.append({"table": name, "comment": None, "columns": columns})
    return out


def query(path, sql: str, limit: int, offset: int) -> dict[str, Any]:
    from .db_engine import (
        DEFAULT_LIMIT,
        MAX_LIMIT,
        _has_top_level_limit,
        _page_sql,
    )

    sql = validate_sql(sql)
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

    exec_sql = _transpile(sql)
    first = exec_sql.split()[0].lower() if exec_sql.split() else ""
    paginated = first not in ("explain", "describe") and not _has_top_level_limit(
        exec_sql, "sqlite"
    )
    with open_db(path) as con:
        cur = con.cursor()
        if not paginated:
            cur.execute(exec_sql)
            fetched = cur.fetchall()
            has_more = False
            rows = [list(r) for r in fetched]
            executed = exec_sql
        else:
            executed, drop_lead, drop_tail = _page_sql(
                "sqlite", exec_sql, limit, offset
            )
            cur.execute(executed)
            fetched = cur.fetchall()
            if drop_lead:
                fetched = fetched[drop_lead:]
            has_more = len(fetched) > limit
            page = fetched[:limit]
            rows = [list(r)[:-drop_tail] if drop_tail else list(r) for r in page]
        columns = [d[0] for d in cur.description] if cur.description else []
    return {
        "columns": columns,
        "rows": rows,
        "rowCount": len(rows),
        "hasMore": has_more,
        "truncated": has_more,
        "paginated": paginated,
        "sql": executed,
    }


def count(path, sql: str) -> int | None:
    try:
        sql = validate_sql(sql)
        with open_db(path) as con:
            cur = con.execute(f"SELECT COUNT(*) FROM ({_transpile(sql)}) AS _sub")
            return int(cur.fetchone()[0])
    except Exception:  # noqa: BLE001
        return None
```

**Step 4: 运行确认通过**

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_access_source.py -q
```
Expected: PASS（`.accdb` 夹具缺失的用例应 skip）。

**Step 5: Commit**

```powershell
git add services/agent/src/fireeyeaud_agent/store/access_source.py services/agent/tests/test_access_source.py
git commit -m "feat(agent): access_source probe/list_tables/query/count API"
```

---

## Task 5: `db_engine` 接入回退（首选 ODBC，失败回退解析器）

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/db_engine.py`
- Test: `services/agent/tests/test_db_engine.py`

**Step 1: 追加失败测试**

在 `test_db_engine.py` 末尾追加：

```python
def _fake_access_conn():
    from pathlib import Path

    fixture = Path(__file__).parent / "fixtures" / "access_sample.mdb"
    if not fixture.exists():
        pytest.skip("access fixture missing")
    return {"id": "conn_acc", "driver": "access", "path": str(fixture)}


def test_access_falls_back_to_parser_on_odbc_failure(monkeypatch):
    conn = _fake_access_conn()

    def boom(*_a, **_k):
        raise RuntimeError("ODBC 不可用")

    # 让首选 ODBC 路径必然失败，验证回退
    monkeypatch.setattr(db_engine, "_engine", boom)

    assert db_engine.test_connection(conn, None) is True

    schema = db_engine.reflect(conn, None)
    assert "users" in {t["table"] for t in schema}

    result = db_engine.run_query(
        conn, "SELECT id, name FROM users ORDER BY id", None, limit=2
    )
    assert result["rows"] == [[1, "Alice"], [2, "Bob"]]
    assert result["hasMore"] is True

    assert db_engine.count_query(conn, "SELECT id FROM users", None) == 5


def test_access_reflect_via_parser(monkeypatch):
    conn = _fake_access_conn()
    monkeypatch.setattr(db_engine, "_engine", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    schema = db_engine.reflect(conn, None)
    users = next(t for t in schema if t["table"] == "users")
    assert {"id", "name", "email", "age", "created"} <= {c["name"] for c in users["columns"]}
```

**Step 2: 运行确认失败**

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_db_engine.py -q
```
Expected: FAIL（当前 access 走 ODBC，报 `E_DB_CONN`）。

**Step 3: 实现回退接线**

在 `db_engine.py` 顶部 import 区（`from .db import build_url` 附近）加：

```python
from . import access_source
```

**3a. `test_connection`（约 72–83 行）** 改为：

```python
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
```

**3b. `reflect`（104–145 行）** 的 `except` 分支改为：

```python
    except ApiError:
        if str(conn.get("driver") or "").lower() == "access":
            return _access_reflect(conn)
        raise
    except Exception as exc:  # noqa: BLE001
        if str(conn.get("driver") or "").lower() == "access":
            return _access_reflect(conn)
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc
```
（其余 try 内逻辑不变。）

**3c. `run_query`（244–307 行）** 的 `except` 分支改为：

```python
    except ApiError:
        if str(conn.get("driver") or "").lower() == "access":
            return _access_query(conn, text_sql, limit, offset)
        raise
    except Exception as exc:  # noqa: BLE001
        if str(conn.get("driver") or "").lower() == "access":
            return _access_query(conn, text_sql, limit, offset)
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc
```

**3d. `count_query`（310–342 行）** 在 `except Exception: return None` 之前加 access 回退：

```python
    except Exception:  # noqa: BLE001 - 计数失败不阻断预览
        if driver == "access":
            return _access_count(conn, text_sql)
        return None
```

**3e. 新增回退辅助函数**（放在 `dialect_for` 之前）：

```python
def _access_probe(conn: dict[str, Any]) -> bool:
    try:
        return access_source.probe(conn.get("path"))
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc


def _access_reflect(conn: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        return access_source.list_tables(conn.get("path"))
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc


def _access_query(
    conn: dict[str, Any], sql: str, limit: int, offset: int
) -> dict[str, Any]:
    try:
        return access_source.query(conn.get("path"), sql, limit, offset)
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_DB_CONN", 502, "error.dbConn", {"reason": str(exc)}) from exc


def _access_count(conn: dict[str, Any], sql: str) -> int | None:
    try:
        return access_source.count(conn.get("path"), sql)
    except Exception:  # noqa: BLE001
        return None
```

> 循环 import 说明：`access_source.query` 内部才 `from .db_engine import ...`（函数级），
> `db_engine` 顶层 `from . import access_source` 不构成环。

**Step 4: 运行确认通过**

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_db_engine.py tests/test_access_source.py -q
```
Expected: PASS（access 夹具缺失则相关用例 skip）。

**Step 5: 回归 + 全量**

```powershell
.\.venv\Scripts\python.exe -m pytest services/agent/tests -q
```
（工作目录 `E:\fireeyeaud`）
Expected: 全绿（SQLite / Oracle / MSSQL 既有用例不受影响；`test_page_sql_dialects` 里的 access TOP 用例仍应通过，因为 `_page_sql` 的 access 分支保留给 ODBC 路径）。

**Step 6: Commit**

```powershell
git add services/agent/src/fireeyeaud_agent/store/db_engine.py services/agent/tests/test_db_engine.py
git commit -m "feat(agent): fall back to access-parser when ODBC access fails"
```

---

## Task 6: 端到端手动验证（真实 UI 路径）

**Files:** 无（手动）

**Step 1: 启动应用**，用工作区打开，进「数据库连接」新建 Access 连接，上传 `D:\tmp\test_access.mdb`。

**Step 2: 测试连接**
Expected: 显示连接成功（实际走的是解析器回退；ODBC 首选会干净失败）。

**Step 3: 反射 + 表授权**
Expected: 列出 `users` / `orders` 及其字段；可勾选授权。

**Step 4: 数据预览**
打开某表预览，翻页；确认分页、总行数正确。

**Step 5: 记录结果**
若失败，收集 `E_DB_CONN` 的 `reason` 与日志，回到 Task 4/5 调试。

---

## Task 7: 文档更新

**Files:**
- Modify: `docs/design/设计说明.md`（约 133 行：Access 说明）
- Modify: `docs/plans/2026-10-09-phase5-database-connections.md`（15、1215 行：Access 依赖本地驱动的描述）

**Step 1: 更新设计说明**

在 `docs/design/设计说明.md` 第 133 行关于「SQLite / Access 可由用户上传数据库文件」的描述后，补一句：

> Access 连接首选 `sqlalchemy-access`(ODBC)；当系统缺少/无法使用 Access 驱动时，自动回退到纯 Python 解析(`access-parser`)，无需 ODBC/JVM。

**Step 2: 更新 phase5 计划**

将「Access 走 `sqlalchemy-access`（若该包不可用则降级并返回 `E_DB_CONN`）」更新为：

> Access 首选 `sqlalchemy-access`(ODBC)，失败回退纯 Python 解析(`access-parser` → 内存 SQLite)。文件上限 1G。回退实现见 `store/access_source.py`。

**Step 3: Commit**

```powershell
git add docs
git commit -m "docs: access pure-python fallback"
```

---

## Task 8: 打包确认（PyInstaller）

**Files:**
- Check: `services/agent/fireeyeaud-agent.spec`

**Step 1: 构建 sidecar**

Run（`services/agent`）：
```powershell
uv run pyinstaller fireeyeaud-agent.spec --noconfirm
```
Expected: 构建成功。

**Step 2: 验证打包内含 `access_parser`**

Run:
```powershell
Get-ChildItem -Recurse services/agent/dist | Where-Object { $_.FullName -match 'access_parser' } | Select-Object -First 5 FullName
```
Expected: 能找到 `access_parser`。

**Step 3: 冒烟**
用打好的可执行起 sidecar，对 `D:\tmp\test_access.mdb` 走一次连接测试（或复用 Task 6）。
Expected: 成功。

**Step 4: 若未自动收集**，在 spec 的 `hiddenimports` / `datas` 中补 `access_parser` 后重跑 Step 1。

---

## 验收标准

1. `pytest services/agent/tests -q` 全绿。
2. 无系统 Access 驱动时，上传 `.mdb` 能：测试连接成功、反射表结构、表授权、数据预览分页与计数正常。
3. SQLite 及其他数据库连接行为不回归。
4. 打包产物包含 `access_parser`。
5. 超过 1G 的 Access 文件返回 `E_DB_CONN`，不崩溃。
