import sqlite3
from pathlib import Path

import pytest

from fireeyeaud_agent.store import access_source


@pytest.fixture(scope="module")
def sample_mdb() -> Path:
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
