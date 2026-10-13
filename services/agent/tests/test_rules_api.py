import httpx

from fireeyeaud_agent.main import app


async def test_rules_api_crud_and_run(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        assert (await client.get("/api/v1/rules")).json()["items"] == []

        created = (
            await client.post(
                "/api/v1/rules",
                json={
                    "name": "非零",
                    "description": "查非零余额",
                    "sql": "SELECT 1 AS n",
                    "scope": "project",
                },
            )
        ).json()
        assert created["id"].startswith("rule_")
        assert created["scope"] == "project"

        run = await client.post(f"/api/v1/rules/{created['id']}/run")
        assert run.status_code == 200
        assert run.json()["rowCount"] == 1

        override = await client.post(
            f"/api/v1/rules/{created['id']}/run", json={"sql": "SELECT 2 AS n"}
        )
        assert override.status_code == 200
        assert override.json()["rows"] == [[2]]

        await client.patch(
            f"/api/v1/rules/{created['id']}?scope=project", json={"enabled": False}
        )
        after = {
            r["id"]: r for r in (await client.get("/api/v1/rules")).json()["items"]
        }
        assert after[created["id"]]["enabled"] is False

        await client.delete(f"/api/v1/rules/{created['id']}?scope=project")
        assert (await client.get("/api/v1/rules")).json()["items"] == []
        await client.post("/api/v1/workspaces/close")


async def test_rule_global_visible_in_other_workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws1").mkdir()
    (tmp_path / "ws2").mkdir()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path / "ws1")})
        created = (
            await client.post(
                "/api/v1/rules",
                json={"name": "标准规则", "sql": "SELECT 1", "scope": "global"},
            )
        ).json()
        assert created["scope"] == "global"
        await client.post("/api/v1/workspaces/close")

        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path / "ws2")})
        items = (await client.get("/api/v1/rules")).json()["items"]
        assert [r["id"] for r in items] == [created["id"]]
        await client.post("/api/v1/workspaces/close")
