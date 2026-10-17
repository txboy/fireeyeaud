import json
from pathlib import Path

import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store.duckdb import Database
from fireeyeaud_agent.store.project import load_project
from fireeyeaud_agent.store.sync import sync_sources


def _datasources(root: Path) -> list[dict]:
    project = load_project(root / ".fireeye") or {}
    return project.get("dataSources", [])


def _columns(root: Path, table: str) -> list[str]:
    db = Database(root / ".fireeye" / "workspace.duckdb")
    try:
        cur = db.query(f'SELECT * FROM "{table}" LIMIT 0')
        return [d[0] for d in cur.description]
    finally:
        db.close()


def test_sync_adds_removes_and_updates(tmp_path) -> None:
    root = tmp_path / "ws"
    root.mkdir()
    a = root / "a.csv"
    a.write_text("x,y\n1,2\n", encoding="utf-8")

    # 新增 → 导入
    result = sync_sources(root)
    assert result["added"] == ["ds_1"]
    assert _columns(root, "src_ds1_a") == ["__row_id", "x", "y"]

    # 修改（新增列）→ 替换，保持同一 sourceId 与表名
    a.write_text("x,y,z\n1,2,3\n4,5,6\n", encoding="utf-8")
    result = sync_sources(root)
    assert result["updated"] == ["ds_1"]
    assert result["added"] == []
    assert _columns(root, "src_ds1_a") == ["__row_id", "x", "y", "z"]
    assert [s["id"] for s in _datasources(root)] == ["ds_1"]

    # 再新增一个文件 → 新数据源
    b = root / "b.csv"
    b.write_text("m\n9\n", encoding="utf-8")
    assert sync_sources(root)["added"] == ["ds_2"]

    # 删除文件 → 移除数据源 + 删表
    b.unlink()
    result = sync_sources(root)
    assert result["removed"] == ["ds_2"]
    assert [s["id"] for s in _datasources(root)] == ["ds_1"]
    db = Database(root / ".fireeye" / "workspace.duckdb")
    try:
        assert db.table_exists("src_ds2_b") is False
    finally:
        db.close()

    # 幂等：无变化时不重复处理
    result = sync_sources(root)
    assert result == {"added": [], "removed": [], "updated": [], "errors": []}


def test_sync_ignores_fireeye_and_temp_files(tmp_path) -> None:
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)
    (root / ".fireeye" / "inner.csv").write_text("x\n1\n", encoding="utf-8")
    (root / "~$a.csv").write_text("x\n1\n", encoding="utf-8")
    assert sync_sources(root)["added"] == []


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


async def test_sync_endpoint(tmp_path) -> None:
    csv = tmp_path / "a.csv"
    csv.write_text("x\n1\n", encoding="utf-8")
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        events: list[dict] = []
        async with client.stream("POST", "/api/v1/datasources/sync") as resp:
            assert resp.status_code == 200
            async for line in resp.aiter_lines():
                if line.startswith("data:"):
                    events.append(json.loads(line[5:].strip()))
        assert events[-1]["type"] == "done"
        assert events[-1]["data"]["added"] == ["ds_1"]
        listed = (await client.get("/api/v1/datasources")).json()["items"]
        assert listed[0]["tables"] == ["src_ds1_a"]
        await client.post("/api/v1/workspaces/close")
