from pathlib import Path

import pytest

from fireeyeaud_agent.store import access_source


@pytest.fixture(autouse=True)
def _clean_cache():
    access_source.reset_cache()
    yield
    access_source.reset_cache()


@pytest.fixture(scope="module")
def sample_mdb() -> Path:
    p = Path(__file__).parent / "fixtures" / "access_sample.mdb"
    if not p.exists():
        pytest.skip("access fixture missing")
    return p


def test_load_materializes_tables(sample_mdb):
    with access_source.open_db(sample_mdb) as con:
        names = {
            r[0]
            for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert {"users", "orders"} <= names
        # 系统表被过滤
        assert not any(n.startswith("MSys") for n in names)

        rows = con.execute("SELECT name FROM users ORDER BY id").fetchall()
        assert [r[0] for r in rows] == ["Alice", "Bob", "Charlie", "Diana", "Eve"]

        cnt = con.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
        assert cnt == 5


def test_open_db_reuses_connection(sample_mdb):
    with access_source.open_db(sample_mdb) as a:
        pass
    with access_source.open_db(sample_mdb) as b:
        pass
    assert a is b


def test_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        with access_source.open_db(tmp_path / "nope.mdb"):
            pass


def test_size_limit(monkeypatch, tmp_path):
    p = tmp_path / "big.mdb"
    p.write_bytes(b"\x00" * 16)
    monkeypatch.setattr(access_source, "MAX_FILE_BYTES", 8)
    with pytest.raises(ValueError):
        with access_source.open_db(p):
            pass


def test_type_inference_and_coercion():
    assert access_source._to_sqlite_type([1, 2]) == "INTEGER"
    assert access_source._to_sqlite_type([1.5, 2]) == "REAL"
    assert access_source._to_sqlite_type(["a", "b"]) == "TEXT"
    assert access_source._to_sqlite_type([None, None]) == "TEXT"
    assert access_source._to_sqlite_type([b"x"]) == "BLOB"

    import datetime

    assert access_source._coerce(True) == 1
    assert access_source._coerce(None) is None
    assert access_source._coerce(datetime.date(2024, 1, 5)) == "2024-01-05"


def test_probe(sample_mdb):
    assert access_source.probe(sample_mdb) is True


def test_list_tables(sample_mdb):
    schema = access_source.list_tables(sample_mdb)
    names = {t["table"] for t in schema}
    assert {"users", "orders"} <= names
    users = next(t for t in schema if t["table"] == "users")
    cols = {c["name"] for c in users["columns"]}
    assert {"id", "name", "email", "age", "created"} <= cols
    assert all(
        set(c) == {"name", "type", "comment", "nullable", "primaryKey"}
        for c in users["columns"]
    )


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
