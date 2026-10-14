import sqlite3
from pathlib import Path

import httpx
import pytest

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store import db_engine


def _sqlite_file(tmp_path: Path) -> Path:
    path = tmp_path / "src.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE t (id INTEGER)")
    con.commit()
    con.close()
    return path


async def test_db_connections_api(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws").mkdir()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            "/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")}
        )
        db_path = str(_sqlite_file(tmp_path))
        res = await client.post(
            "/api/v1/db/connections",
            json={
                "name": "本地",
                "driver": "sqlite",
                "path": db_path,
                "scope": "project",
            },
        )
        assert res.status_code == 200
        conn = res.json()
        assert conn["id"] == "conn_1"

        listed = (await client.get("/api/v1/db/connections")).json()["items"]
        assert [c["id"] for c in listed] == ["conn_1"]

        patched = await client.patch(
            "/api/v1/db/connections/conn_1?scope=project",
            json={"name": "本地库", "path": db_path},
        )
        assert patched.status_code == 200
        assert patched.json()["name"] == "本地库"

        ok = (
            await client.post("/api/v1/db/connections/conn_1/test?scope=project")
        ).json()
        assert ok["ok"] is True

        await client.delete("/api/v1/db/connections/conn_1?scope=project")
        await client.post("/api/v1/workspaces/close")


async def test_db_test_params(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    db_path = str(_sqlite_file(tmp_path))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        ok = (
            await client.post(
                "/api/v1/db/test", json={"driver": "sqlite", "path": db_path}
            )
        ).json()
        assert ok["ok"] is True

        bad = await client.post(
            "/api/v1/db/test",
            json={"driver": "sqlite", "path": str(tmp_path / "missing.db")},
        )
        assert bad.status_code == 502


async def test_db_create_oracle_connection_keeps_connect_by(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws").mkdir()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            "/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")}
        )
        res = await client.post(
            "/api/v1/db/connections",
            json={
                "name": "orcl",
                "driver": "oracle",
                "host": "h",
                "port": 1521,
                "database": "XE",
                "username": "u",
                "connectBy": "sid",
                "scope": "project",
            },
        )
        assert res.status_code == 200
        conn = res.json()
        assert conn["driver"] == "oracle"
        assert conn["connectBy"] == "sid"
        await client.post("/api/v1/workspaces/close")


async def test_db_connections_no_workspace():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/v1/db/connections")).json()["items"] == []


async def test_access_fallback_end_to_end_api(tmp_path, monkeypatch):
    """Access 纯 Python 回退的端到端 API 链路（强制 ODBC 建连失败）。"""
    fixture = Path(__file__).parent / "fixtures" / "access_sample.mdb"
    if not fixture.exists():
        pytest.skip("access fixture missing")

    def _broken_engine(conn, password):
        raise RuntimeError("odbc unavailable")

    monkeypatch.setattr(db_engine, "_engine", _broken_engine)
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws").mkdir()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            "/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")}
        )
        conn = (
            await client.post(
                "/api/v1/db/connections",
                json={
                    "name": "acc",
                    "driver": "access",
                    "path": str(fixture),
                    "scope": "project",
                },
            )
        ).json()

        ok = (
            await client.post(
                f"/api/v1/db/connections/{conn['id']}/test?scope=project"
            )
        ).json()
        assert ok["ok"] is True

        reflected = (
            await client.post(
                f"/api/v1/db/connections/{conn['id']}/reflect?scope=project"
            )
        ).json()
        assert {"users", "orders"} <= set(reflected["tables"])
        assert {t["table"] for t in reflected["schema"]} >= {"users", "orders"}

        base = f"/api/v1/db/connections/{conn['id']}/query?scope=project"
        sql = "SELECT id, name FROM users ORDER BY id"
        page1 = (
            await client.post(
                base, json={"sql": sql, "limit": 2, "includeTotal": True}
            )
        ).json()
        assert page1["rows"] == [[1, "Alice"], [2, "Bob"]]
        assert page1["hasMore"] is True
        assert page1["total"] == 5
        assert page1["rowCount"] == 2

        page2 = (
            await client.post(base, json={"sql": sql, "limit": 2, "offset": 2})
        ).json()
        assert page2["rows"] == [[3, "Charlie"], [4, "Diana"]]

        bad = await client.post(base, json={"sql": "DROP TABLE users"})
        assert bad.status_code == 400

        await client.post("/api/v1/workspaces/close")
