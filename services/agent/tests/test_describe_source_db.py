import json

from fireeyeaud_agent.store import authorization
from fireeyeaud_agent.tools.describe_source import describe_source


def test_describe_source_filters_db_columns(tmp_path):
    fe = tmp_path / ".fireeye"
    (fe / "index").mkdir(parents=True)
    (fe / "index" / "schema.json").write_text(
        json.dumps(
            [
                {
                    "sourceId": "ds_1",
                    "connectionId": "conn_1",
                    "table": "customers",
                    "rowCount": None,
                    "columns": [
                        {"name": "id", "type": "INTEGER", "sample": ""},
                        {"name": "secret", "type": "TEXT", "sample": ""},
                    ],
                }
            ]
        ),
        "utf-8",
    )
    authorization.set_entry(tmp_path, "conn_1", {"customers": ["id"]})
    result = describe_source(tmp_path, {"sourceId": "ds_1"})
    cols = {c["name"] for t in result["tables"] for c in t["columns"]}
    assert cols == {"id"}


def test_describe_source_hides_unauthorized_table(tmp_path):
    fe = tmp_path / ".fireeye"
    (fe / "index").mkdir(parents=True)
    (fe / "index" / "schema.json").write_text(
        json.dumps(
            [
                {
                    "sourceId": "ds_1",
                    "connectionId": "conn_1",
                    "table": "customers",
                    "columns": [{"name": "id", "type": "INTEGER", "sample": ""}],
                }
            ]
        ),
        "utf-8",
    )
    result = describe_source(tmp_path, {"sourceId": "ds_1"})
    assert result["tables"] == []


def test_describe_source_keeps_file_tables(tmp_path):
    fe = tmp_path / ".fireeye"
    (fe / "index").mkdir(parents=True)
    (fe / "index" / "schema.json").write_text(
        json.dumps(
            [
                {
                    "sourceId": "ds_1",
                    "table": "src_ds1_序时账",
                    "columns": [{"name": "科目", "type": "string", "sample": ""}],
                }
            ]
        ),
        "utf-8",
    )
    result = describe_source(tmp_path, {})
    assert result["tables"][0]["table"] == "src_ds1_序时账"
