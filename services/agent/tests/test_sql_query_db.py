import sqlite3

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
    result = sql_query(
        ws, {"sql": "SELECT id, name FROM customers", "sourceId": conn["id"]}
    )
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
