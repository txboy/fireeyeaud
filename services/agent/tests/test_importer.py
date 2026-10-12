import json

import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store.importer import (
    delete_source,
    import_source,
    sanitize_table_name,
)


def test_sanitize_table_name():
    assert sanitize_table_name("序时账") == "序时账"
    assert sanitize_table_name("a b/c") == "a_b_c"


def test_import_source_registers_datasource(tmp_path):
    csv = tmp_path / "余额表.csv"
    csv.write_text("科目,借方\n1001,3200000.00\n", encoding="utf-8")
    ws_root = tmp_path / "ws"
    ws_root.mkdir()
    result = import_source(ws_root, csv)
    assert result["sourceId"] == "ds_1"
    assert result["tables"] == ["src_ds1_余额表"]
    assert (ws_root / ".fireeye" / "index" / "schema.json").exists()
    assert (ws_root / ".fireeye" / "workspace.duckdb").exists()
    project = json.loads((ws_root / ".fireeye" / "project.json").read_text("utf-8"))
    assert project["dataSources"][0]["id"] == "ds_1"
    assert project["counters"]["dataSource"] == 1


def test_import_source_reports_progress(tmp_path):
    csv = tmp_path / "a.csv"
    csv.write_text("x\n1\n2\n", encoding="utf-8")
    ws_root = tmp_path / "ws"
    ws_root.mkdir()
    phases = []
    import_source(
        ws_root, csv, progress=lambda phase, done, total: phases.append(phase)
    )
    assert phases[0] == "parse"
    assert "load" in phases
    assert phases[-1] == "index"


def test_import_duplicate_raises(tmp_path):
    csv = tmp_path / "a.csv"
    csv.write_text("x\n1\n", encoding="utf-8")
    ws_root = tmp_path / "ws"
    ws_root.mkdir()
    import_source(ws_root, csv)
    with pytest.raises(ApiError) as exc:
        import_source(ws_root, csv)
    assert exc.value.code == "E_IMPORT_DUP"


def test_delete_source_removes_registration(tmp_path):
    from fireeyeaud_agent.store.duckdb import Database

    csv = tmp_path / "a.csv"
    csv.write_text("x\n1\n2\n", encoding="utf-8")
    ws_root = tmp_path / "ws"
    ws_root.mkdir()
    import_source(ws_root, csv)
    fe = ws_root / ".fireeye"

    result = delete_source(ws_root, "ds_1")
    assert result == {"ok": True, "sourceId": "ds_1"}
    project = json.loads((fe / "project.json").read_text("utf-8"))
    assert project["dataSources"] == []
    assert json.loads((fe / "index" / "schema.json").read_text("utf-8")) == []
    assert json.loads((fe / "index" / "files.json").read_text("utf-8")) == []

    db = Database(fe / "workspace.duckdb")
    try:
        assert db.table_exists("src_ds1_a") is False
    finally:
        db.close()


def test_delete_source_missing_raises(tmp_path):
    ws_root = tmp_path / "ws"
    ws_root.mkdir()
    (ws_root / ".fireeye").mkdir()
    with pytest.raises(ApiError) as exc:
        delete_source(ws_root, "ds_9")
    assert exc.value.code == "E_DS_NOT_FOUND"
