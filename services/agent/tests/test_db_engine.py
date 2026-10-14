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
    cols = {
        c["name"] for t in schema if t["table"] == "customers" for c in t["columns"]
    }
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


def test_column_meta_maps_metadata():
    meta = db_engine._column_meta(
        {"name": "amount", "type": "NUMERIC(14, 2)", "nullable": False, "comment": "交易金额"},
        is_pk=False,
    )
    assert meta == {
        "name": "amount",
        "type": "NUMERIC(14, 2)",
        "comment": "交易金额",
        "nullable": False,
        "primaryKey": False,
    }


def test_column_meta_defaults_and_pk():
    meta = db_engine._column_meta({"name": "id", "type": "INTEGER", "nullable": False}, is_pk=True)
    assert meta["primaryKey"] is True
    assert meta["comment"] is None


def test_reflect_includes_column_metadata(tmp_path):
    path = _sqlite_file(tmp_path)
    conn = {"id": "conn_1", "driver": "sqlite", "path": str(path)}
    schema = db_engine.reflect(conn, None)
    table = next(t for t in schema if t["table"] == "customers")
    assert "comment" in table

    col = next(c for c in table["columns"] if c["name"] == "id")
    assert set(col) == {"name", "type", "comment", "nullable", "primaryKey"}
    assert col["comment"] is None


def test_connect_kwargs_have_connect_timeout():
    """各驱动都必须带连接超时，避免不可达主机长时间挂起。"""
    timeout = db_engine.CONNECT_TIMEOUT
    assert timeout > 0

    sqlite = db_engine._connect_kwargs({"driver": "sqlite"})
    assert sqlite["connect_args"]["uri"] is True
    assert sqlite["connect_args"]["timeout"] == timeout

    for driver in ("postgresql", "mysql"):
        args = db_engine._connect_kwargs({"driver": driver})["connect_args"]
        assert args["connect_timeout"] == timeout

    for driver in ("mssql", "access"):
        args = db_engine._connect_kwargs({"driver": driver})["connect_args"]
        assert args["timeout"] == timeout


def _sqlite_nums(tmp_path: Path, n: int = 5) -> Path:
    path = tmp_path / "nums.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE nums (id INTEGER, label TEXT)")
    con.executemany(
        "INSERT INTO nums VALUES (?, ?)", [(i, f"n{i}") for i in range(1, n + 1)]
    )
    con.commit()
    con.close()
    return path


def test_run_query_offset_paginates(tmp_path):
    conn = {"id": "conn_1", "driver": "sqlite", "path": str(_sqlite_nums(tmp_path))}
    sql = "SELECT id FROM nums ORDER BY id"

    page1 = db_engine.run_query(conn, sql, None, limit=2, offset=0)
    assert page1["rows"] == [[1], [2]]
    assert page1["rowCount"] == 2
    assert page1["hasMore"] is True
    assert "LIMIT 3 OFFSET 0" in page1["sql"]

    page2 = db_engine.run_query(conn, sql, None, limit=2, offset=2)
    assert page2["rows"] == [[3], [4]]
    assert page2["hasMore"] is True

    page3 = db_engine.run_query(conn, sql, None, limit=2, offset=4)
    assert page3["rows"] == [[5]]
    assert page3["hasMore"] is False


def test_run_query_offset_negative_clamped(tmp_path):
    conn = {"id": "conn_1", "driver": "sqlite", "path": str(_sqlite_nums(tmp_path))}
    result = db_engine.run_query(
        conn, "SELECT id FROM nums ORDER BY id", None, limit=2, offset=-5
    )
    assert result["rows"] == [[1], [2]]


def test_run_query_keeps_user_limit(tmp_path):
    """用户 SQL 自带 LIMIT 时按原样执行，不额外包装、不分页。"""
    files = _sqlite_nums(tmp_path)
    conn = {"id": "conn_1", "driver": "sqlite", "path": str(files)}
    result = db_engine.run_query(
        conn, "SELECT id FROM nums ORDER BY id LIMIT 2", None, limit=5, offset=2
    )
    assert result["rows"] == [[1], [2]]
    assert result["paginated"] is False
    assert result["hasMore"] is False
    assert result["sql"] == "SELECT id FROM nums ORDER BY id LIMIT 2"


def test_run_query_nested_limit_still_paginated(tmp_path):
    """子查询里的 LIMIT 不算，仍需包装分页。"""
    conn = {"id": "conn_1", "driver": "sqlite", "path": str(_sqlite_nums(tmp_path))}
    result = db_engine.run_query(
        conn, "SELECT * FROM (SELECT id FROM nums ORDER BY id LIMIT 4) AS t", None
    )
    assert result["paginated"] is True
    assert result["sql"].startswith("SELECT * FROM (SELECT * FROM ")


def test_page_sql_dialects():
    pg, lead, tail = db_engine._page_sql("postgresql", "SELECT 1", 10, 20)
    assert pg == "SELECT * FROM (SELECT 1) AS _sub LIMIT 11 OFFSET 20"
    assert (lead, tail) == (0, 0)

    sqlite, lead, tail = db_engine._page_sql("sqlite", "SELECT 1", 10, 20)
    assert sqlite.endswith("LIMIT 11 OFFSET 20")
    assert (lead, tail) == (0, 0)

    # MSSQL 不包装，直接在原 SQL 末尾追加 OFFSET/FETCH；无 ORDER BY 时补一个。
    ms, lead, tail = db_engine._page_sql("mssql", "SELECT 1", 10, 20)
    assert ms == "SELECT 1 ORDER BY (SELECT NULL) OFFSET 20 ROWS FETCH NEXT 11 ROWS ONLY"
    assert (lead, tail) == (0, 0)

    # 原 SQL 自带 ORDER BY 时不再重复添加，直接追加 OFFSET/FETCH。
    ms2, lead, tail = db_engine._page_sql("mssql", "SELECT id FROM t ORDER BY id", 10, 20)
    assert ms2 == "SELECT id FROM t ORDER BY id OFFSET 20 ROWS FETCH NEXT 11 ROWS ONLY"
    assert (lead, tail) == (0, 0)

    acc, lead, tail = db_engine._page_sql("access", "SELECT 1", 10, 20)
    assert acc == "SELECT TOP 31 * FROM (SELECT 1) AS _sub"
    assert (lead, tail) == (20, 0)


def test_page_sql_oracle_modern_uses_offset_fetch():
    # Oracle 12c+：OFFSET/FETCH；表别名不能用 AS，且未加引号标识符不能以 _ 开头。
    sql, lead, tail = db_engine._page_sql(
        "oracle", "SELECT * FROM t ORDER BY id", 10, 20, (19, 3, 0, 0, 0)
    )
    assert sql == (
        "SELECT * FROM (SELECT * FROM t ORDER BY id) sub "
        "OFFSET 20 ROWS FETCH NEXT 11 ROWS ONLY"
    )
    assert (lead, tail) == (0, 0)


def test_page_sql_oracle_legacy_uses_rownum():
    # Oracle 11g：ROWNUM 双层，多出的 rnum 列由调用方丢弃。
    sql, lead, tail = db_engine._page_sql(
        "oracle", "SELECT * FROM t ORDER BY id", 10, 20, (11, 2, 0, 1, 0)
    )
    assert sql == (
        "SELECT * FROM (SELECT a.*, ROWNUM rnum FROM (SELECT * FROM t ORDER BY id) a "
        "WHERE ROWNUM <= 31) WHERE rnum > 20"
    )
    assert (lead, tail) == (0, 1)


def test_wrap_subquery_oracle_has_no_as():
    # Oracle 未加引号标识符不能以 _ 开头，别名用 sub。
    assert db_engine._wrap_subquery("oracle", "SELECT 1") == "(SELECT 1) sub"
    assert db_engine._wrap_subquery("postgresql", "SELECT 1") == "(SELECT 1) AS _sub"


def test_engine_oracle_includes_system_tablespace():
    # SQLAlchemy Oracle 默认排除 SYSTEM/SYSAUX 表空间，会让 SYSTEM schema 的表全部消失。
    eng = db_engine._engine(
        {"driver": "oracle", "host": "h", "port": 1521, "database": "X", "username": "u"},
        "p",
    )
    assert list(eng.dialect.exclude_tablespaces) == []


def test_reflect_name_oracle_uppercases():
    # SQLAlchemy 会把 Oracle 反射名小写化，需还原为真实（未加引号时为大写）的名字。
    assert db_engine._reflect_name("oracle", "customers") == "CUSTOMERS"
    assert db_engine._reflect_name("postgresql", "customers") == "customers"


def test_suppress_sa_warnings():
    import warnings as _warnings

    from sqlalchemy.exc import SAWarning

    with _warnings.catch_warnings(record=True) as rec:
        _warnings.simplefilter("always")
        with db_engine._suppress_sa_warnings():
            _warnings.warn("unknown type", SAWarning)
    assert rec == []


def test_dialect_for_oracle():
    assert db_engine.dialect_for({"driver": "oracle"}) == "oracle"


def test_probe_query_oracle_uses_dual():
    # Oracle 的 SELECT 必须带 FROM dual，否则 ORA-00923。
    assert db_engine._probe_query("oracle") == "SELECT 1 FROM dual"
    assert db_engine._probe_query("postgresql") == "SELECT 1"


def test_connect_kwargs_oracle():
    assert db_engine._connect_kwargs({"driver": "oracle"}) == {
        "connect_args": {"tcp_connect_timeout": db_engine.CONNECT_TIMEOUT}
    }


def test_strip_top_level_order():
    out = db_engine._strip_top_level_order(
        "SELECT * FROM [customers] ORDER BY [id]", "tsql"
    )
    assert out == "SELECT * FROM [customers]"
    assert db_engine._strip_top_level_order("SELECT 1", "sqlite") == "SELECT 1"


def test_count_query(tmp_path):
    conn = {"id": "conn_1", "driver": "sqlite", "path": str(_sqlite_nums(tmp_path))}
    assert db_engine.count_query(conn, "SELECT id FROM nums", None) == 5
    assert db_engine.count_query(conn, "SELECT id FROM nums WHERE id > 3", None) == 2


def test_count_query_failure_returns_none(tmp_path):
    conn = {"id": "conn_1", "driver": "sqlite", "path": str(tmp_path / "missing.db")}
    assert db_engine.count_query(conn, "SELECT 1", None) is None


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
    monkeypatch.setattr(
        db_engine, "_engine", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x"))
    )
    schema = db_engine.reflect(conn, None)
    users = next(t for t in schema if t["table"] == "users")
    assert {"id", "name", "email", "age", "created"} <= {
        c["name"] for c in users["columns"]
    }
