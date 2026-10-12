import json

import httpx

from fireeyeaud_agent.main import app


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


async def test_list_datasources_empty(tmp_path) -> None:
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        resp = await client.get("/api/v1/datasources")
        assert resp.status_code == 200
        assert resp.json() == {"items": [], "nextCursor": None}
        await client.post("/api/v1/workspaces/close")


async def test_import_requires_workspace(tmp_path) -> None:
    async with _client() as client:
        await client.post("/api/v1/workspaces/close")
        resp = await client.post(
            "/api/v1/datasources/import", json={"path": str(tmp_path / "x.csv")}
        )
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "E_NO_WORKSPACE"


async def test_import_stream(tmp_path) -> None:
    csv = tmp_path / "a.csv"
    csv.write_text("x\n1\n2\n", encoding="utf-8")
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        events: list[dict] = []
        async with client.stream(
            "POST", "/api/v1/datasources/import", json={"path": str(csv)}
        ) as resp:
            assert resp.status_code == 200
            async for line in resp.aiter_lines():
                if line.startswith("data:"):
                    events.append(json.loads(line[5:].strip()))
        types = [e["type"] for e in events]
        assert "import_progress" in types
        assert types[-1] == "done"
        listed = (await client.get("/api/v1/datasources")).json()["items"]
        assert listed[0]["tables"] == ["src_ds1_a"]
        await client.post("/api/v1/workspaces/close")


async def test_delete_datasource(tmp_path) -> None:
    csv = tmp_path / "a.csv"
    csv.write_text("x\n1\n2\n", encoding="utf-8")
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        async with client.stream(
            "POST", "/api/v1/datasources/import", json={"path": str(csv)}
        ) as resp:
            async for _ in resp.aiter_lines():
                pass
        listed = (await client.get("/api/v1/datasources")).json()["items"]
        assert listed[0]["id"] == "ds_1"

        resp = await client.delete("/api/v1/datasources/ds_1")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert (await client.get("/api/v1/datasources")).json()["items"] == []

        missing = await client.delete("/api/v1/datasources/ds_404")
        assert missing.status_code == 404
        assert missing.json()["error"]["code"] == "E_DS_NOT_FOUND"
        await client.post("/api/v1/workspaces/close")
