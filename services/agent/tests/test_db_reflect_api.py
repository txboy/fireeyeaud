import sqlite3
from pathlib import Path

import httpx

from fireeyeaud_agent.main import app


def _sqlite_file(tmp_path: Path) -> Path:
    path = tmp_path / "src.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE customers (id INTEGER, name TEXT)")
    con.commit()
    con.close()
    return path


async def test_reflect_registers_datasource_and_schema(tmp_path, monkeypatch):
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
                    "name": "本地",
                    "driver": "sqlite",
                    "path": str(_sqlite_file(tmp_path)),
                    "scope": "project",
                },
            )
        ).json()
        res = await client.post(
            f"/api/v1/db/connections/{conn['id']}/reflect?scope=project"
        )
        assert res.status_code == 200
        body = res.json()
        assert body["sourceId"].startswith("ds_")
        assert body["tables"] == ["customers"]

        schema = (await client.get("/api/v1/datasources")).json()["items"]
        assert any(ds.get("connectionId") == conn["id"] for ds in schema)
        await client.post("/api/v1/workspaces/close")


async def test_reflect_is_idempotent_per_connection(tmp_path, monkeypatch):
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
                    "name": "本地",
                    "driver": "sqlite",
                    "path": str(_sqlite_file(tmp_path)),
                    "scope": "project",
                },
            )
        ).json()

        first = (
            await client.post(f"/api/v1/db/connections/{conn['id']}/reflect?scope=project")
        ).json()
        second = (
            await client.post(f"/api/v1/db/connections/{conn['id']}/reflect?scope=project")
        ).json()

        assert first["sourceId"] == second["sourceId"]
        items = (await client.get("/api/v1/datasources")).json()["items"]
        assert len([ds for ds in items if ds.get("connectionId") == conn["id"]]) == 1
        await client.post("/api/v1/workspaces/close")
