import pytest

from fireeyeaud_agent.store.duckdb import Database


def test_create_table_and_query(tmp_path):
    db = Database(tmp_path / "workspace.duckdb")
    db.execute("CREATE TABLE src_ds1_x (__row_id VARCHAR, a VARCHAR)")
    db.execute("INSERT INTO src_ds1_x VALUES ('1', 'hello')")
    rows = db.query("SELECT a FROM src_ds1_x").fetchall()
    assert rows == [("hello",)]
    db.close()


def test_delete_table_idempotent(tmp_path):
    db = Database(tmp_path / "workspace.duckdb")
    db.create_table_from_rows("src_ds1_x", ["__row_id", "a"], [["1", "v"]])
    db.drop_table("src_ds1_x")
    db.drop_table("src_ds1_x")
    assert db.table_exists("src_ds1_x") is False
    db.close()


def test_duckdb_blocks_external_files(tmp_path):
    db = Database(tmp_path / "x.duckdb")
    try:
        with pytest.raises(Exception) as exc:
            db.query("SELECT * FROM read_csv('/etc/passwd')").fetchall()
        assert "disabled by configuration" in str(exc.value) or "Permission" in str(
            exc.value
        )
    finally:
        db.close()


def test_fetchall_interrupts_on_timeout(tmp_path):
    db = Database(tmp_path / "x.duckdb")
    seen = {"interrupted": False}

    class _SlowCursor:
        description = [("a",)]

        def fetchall(self):
            import time

            time.sleep(0.2)
            return [[1]]

    class _SlowCon:
        def execute(self, *_args, **_kwargs):
            return _SlowCursor()

        def interrupt(self):
            seen["interrupted"] = True

        def close(self):
            pass

    db._con = _SlowCon()
    rows, cols = db.fetchall("SELECT 1", timeout_seconds=0.05)
    assert rows == [[1]]
    assert cols == ["a"]
    assert seen["interrupted"] is True
    db.close()
