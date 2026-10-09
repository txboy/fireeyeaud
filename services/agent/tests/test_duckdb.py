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
