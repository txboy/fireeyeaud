import json
from concurrent.futures import ThreadPoolExecutor

import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store.importer import (
    delete_source,
    import_source,
    sanitize_table_name,
)
from fireeyeaud_agent.store.project import load_project


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


def test_import_same_path_replaces_in_place(tmp_path):
    """同一路径再次导入应重新读取并覆盖，而不是被 SHA 缓存判重复。"""
    csv = tmp_path / "a.csv"
    csv.write_text("x\n1\n", encoding="utf-8")
    ws_root = tmp_path / "ws"
    ws_root.mkdir()
    first = import_source(ws_root, csv)

    csv.write_text("x,y\n1,2\n", encoding="utf-8")
    second = import_source(ws_root, csv)

    assert second["sourceId"] == first["sourceId"] == "ds_1"
    assert second["tables"] == ["src_ds1_a"]
    project = load_project(ws_root / ".fireeye")
    assert [s["id"] for s in project["dataSources"]] == ["ds_1"]
    files = json.loads(
        (ws_root / ".fireeye" / "index" / "files.json").read_text("utf-8")
    )
    assert len(files) == 1

    from fireeyeaud_agent.store.duckdb import Database

    db = Database(ws_root / ".fireeye" / "workspace.duckdb")
    try:
        cur = db.query('SELECT * FROM "src_ds1_a" LIMIT 0')
        assert [d[0] for d in cur.description] == ["__row_id", "x", "y"]
    finally:
        db.close()


def test_import_same_content_different_path_creates_new_source(tmp_path):
    """相同内容的不同文件是合法的新数据源，不应按 SHA 判重。"""
    ws_root = tmp_path / "ws"
    ws_root.mkdir()
    a = tmp_path / "a.csv"
    b = tmp_path / "b.csv"
    a.write_text("x\n1\n", encoding="utf-8")
    b.write_text("x\n1\n", encoding="utf-8")

    assert import_source(ws_root, a)["sourceId"] == "ds_1"
    assert import_source(ws_root, b)["sourceId"] == "ds_2"


def test_concurrent_imports_keep_all_sources(tmp_path):
    ws_root = tmp_path / "ws"
    ws_root.mkdir()
    files = []
    for i in range(6):
        path = tmp_path / f"f{i}.csv"
        path.write_text(f"x\n{i}\n", encoding="utf-8")
        files.append(path)

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda p: import_source(ws_root, p), files))

    ids = [r["sourceId"] for r in results]
    assert len(ids) == len(set(ids)) == 6
    project = load_project(ws_root / ".fireeye")
    assert len(project["dataSources"]) == 6
    assert sorted(s["id"] for s in project["dataSources"]) == sorted(ids)


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
