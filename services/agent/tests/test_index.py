from fireeyeaud_agent.store.index import load_schema, save_schema, upsert_schema_entry


def _entry(table: str) -> dict:
    return {
        "sourceId": "ds_1",
        "table": table,
        "rowCount": 2,
        "headerRow": 1,
        "columns": [{"name": "科目", "type": "string", "sample": "1001"}],
    }


def test_save_and_load_schema(tmp_path):
    path = tmp_path / "schema.json"
    upsert_schema_entry(path, _entry("src_ds1_a"))
    upsert_schema_entry(path, _entry("src_ds1_b"))
    data = load_schema(path)
    assert [e["table"] for e in data] == ["src_ds1_a", "src_ds1_b"]
    save_schema(path, [])
    assert load_schema(path) == []


def test_load_schema_missing_returns_empty(tmp_path):
    assert load_schema(tmp_path / "none.json") == []
