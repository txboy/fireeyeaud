"""数据库连接通用查询路由（表数据预览）。"""

import sqlite3
from pathlib import Path

import httpx

from fireeyeaud_agent.main import app


def _sqlite_nums(tmp_path: Path, n: int = 5) -> Path:
    path = tmp_path / "nums.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE nums (id INTEGER, label TEXT)")
    con.executemany(
        "INSERT INTO nums VALUES (?, ?)", [(i, f"n{i}") for i in range(1, n + 1)]
    )
    con.commit()
    con.close()
    return path


async def _open_with_conn(client, tmp_path) -> dict:
    (tmp_path / "ws").mkdir(exist_ok=True)
    await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")})
    return (
        await client.post(
            "/api/v1/db/connections",
            json={
                "name": "本地",
                "driver": "sqlite",
                "path": str(_sqlite_nums(tmp_path)),
                "scope": "project",
            },
        )
    ).json()


async def test_db_query_pagination(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conn = await _open_with_conn(client, tmp_path)
        base = f"/api/v1/db/connections/{conn['id']}/query?scope=project"
        sql = "SELECT id FROM nums ORDER BY id"

        page1 = (
            await client.post(base, json={"sql": sql, "limit": 2, "offset": 0})
        ).json()
        assert page1["columns"] == ["id"]
        assert page1["rows"] == [[1], [2]]
        assert page1["rowCount"] == 2
        assert page1["hasMore"] is True
        assert page1["total"] == 5
        assert page1["offset"] == 0
        assert page1["paginated"] is True
        assert page1["sql"] == "SELECT * FROM (SELECT id FROM nums ORDER BY id) AS _sub LIMIT 3 OFFSET 0"

        page3 = (
            await client.post(
                base,
                json={"sql": sql, "limit": 2, "offset": 4, "includeTotal": False},
            )
        ).json()
        assert page3["rows"] == [[5]]
        assert page3["hasMore"] is False
        assert page3["total"] is None

        await client.post("/api/v1/workspaces/close")


async def test_db_query_respects_user_limit(tmp_path, monkeypatch):
    """用户 SQL 自带 LIMIT 时按原样执行（不额外包装、不分页）。"""
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conn = await _open_with_conn(client, tmp_path)
        base = f"/api/v1/db/connections/{conn['id']}/query?scope=project"
        page = (
            await client.post(
                base,
                json={"sql": "SELECT id FROM nums ORDER BY id LIMIT 2", "limit": 50},
            )
        ).json()
        assert page["paginated"] is False
        assert page["rows"] == [[1], [2]]
        assert page["hasMore"] is False
        assert page["total"] == 2
        assert page["sql"] == "SELECT id FROM nums ORDER BY id LIMIT 2"
        await client.post("/api/v1/workspaces/close")


async def test_db_query_rejects_write(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conn = await _open_with_conn(client, tmp_path)
        base = f"/api/v1/db/connections/{conn['id']}/query?scope=project"
        bad = await client.post(base, json={"sql": "DELETE FROM nums"})
        assert bad.status_code == 400
        await client.post("/api/v1/workspaces/close")


async def test_db_query_unknown_connection(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        (tmp_path / "ws").mkdir(exist_ok=True)
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")})
        res = await client.post(
            "/api/v1/db/connections/nope/query?scope=project",
            json={"sql": "SELECT 1"},
        )
        assert res.status_code == 404
        await client.post("/api/v1/workspaces/close")
