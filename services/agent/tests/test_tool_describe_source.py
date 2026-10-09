from fireeyeaud_agent.store.index import save_schema
from fireeyeaud_agent.tools.describe_source import describe_source


def _seed(tmp_path):
    fe = tmp_path / ".fireeye"
    (fe / "index").mkdir(parents=True)
    save_schema(
        fe / "index" / "schema.json",
        [
            {
                "sourceId": "ds_1",
                "table": "src_ds1_a",
                "rowCount": 2,
                "headerRow": 1,
                "columns": [{"name": "科目", "type": "string", "sample": "1001"}],
            },
            {
                "sourceId": "ds_2",
                "table": "src_ds2_b",
                "rowCount": 0,
                "headerRow": 1,
                "columns": [],
            },
        ],
    )


def test_describe_source_all(tmp_path):
    _seed(tmp_path)
    out = describe_source(tmp_path, {})
    assert [t["table"] for t in out["tables"]] == ["src_ds1_a", "src_ds2_b"]
    assert out["tables"][0]["columns"][0]["name"] == "科目"


def test_describe_source_by_table(tmp_path):
    _seed(tmp_path)
    out = describe_source(tmp_path, {"table": "src_ds2_b"})
    assert [t["table"] for t in out["tables"]] == ["src_ds2_b"]


def test_describe_source_by_source(tmp_path):
    _seed(tmp_path)
    out = describe_source(tmp_path, {"sourceId": "ds_1"})
    assert [t["table"] for t in out["tables"]] == ["src_ds1_a"]
