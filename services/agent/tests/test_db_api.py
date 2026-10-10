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
        res = await client.post(
            "/api/v1/db/connections",
            json={
                "name": "本地",
                "driver": "sqlite",
                "path": str(_sqlite_file(tmp_path)),
                "scope": "project",
            },
        )
        assert res.status_code == 200
        conn = res.json()
        assert conn["id"] == "conn_1"

        listed = (await client.get("/api/v1/db/connections")).json()["items"]
        assert [c["id"] for c in listed] == ["conn_1"]

        ok = (
            await client.post("/api/v1/db/connections/conn_1/test?scope=project")
        ).json()
        assert ok["ok"] is True

        await client.delete("/api/v1/db/connections/conn_1?scope=project")
        await client.post("/api/v1/workspaces/close")


async def test_db_connections_no_workspace():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/v1/db/connections")).json()["items"] == []
