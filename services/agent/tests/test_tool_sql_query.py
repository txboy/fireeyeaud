import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store.duckdb import Database
from fireeyeaud_agent.tools.sql_query import sql_query


def _seed(tmp_path):
    fe = tmp_path / ".fireeye"
    fe.mkdir()
    db = Database(fe / "workspace.duckdb")
    db.create_table_from_rows(
        "src_ds1_x", ["__row_id", "a"], [["1", "hello"], ["2", "world"]]
    )
    db.close()


def test_sql_query_returns_rows(tmp_path):
    _seed(tmp_path)
    out = sql_query(tmp_path, {"sql": "SELECT a FROM src_ds1_x ORDER BY a"})
    assert out["columns"] == ["a"]
    assert out["rows"] == [["hello"], ["world"]]
    assert out["rowCount"] == 2
    assert out["truncated"] is False


def test_sql_query_truncates(tmp_path):
    _seed(tmp_path)
    out = sql_query(tmp_path, {"sql": "SELECT a FROM src_ds1_x", "limit": 1})
    assert out["rowCount"] == 1
    assert out["truncated"] is True
    assert out["artifactRef"].startswith("artifacts/")


def test_sql_query_rejects_write(tmp_path):
    _seed(tmp_path)
    with pytest.raises(ApiError) as exc:
        sql_query(tmp_path, {"sql": "DROP TABLE src_ds1_x"})
    assert exc.value.code == "E_SQL_REJECTED"
