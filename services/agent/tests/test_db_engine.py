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
