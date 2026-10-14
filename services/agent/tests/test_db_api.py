import sqlite3
from pathlib import Path

import httpx

from fireeyeaud_agent.main import app


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
