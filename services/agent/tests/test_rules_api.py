import httpx

from fireeyeaud_agent.main import app


async def test_rules_api_crud_and_run(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        assert (await client.get("/api/v1/rules")).json()["items"] == []

        created = (
            await client.post(
                "/api/v1/rules",
                json={"name": "非零", "description": "查非零余额", "sql": "SELECT 1 AS n"},
            )
        ).json()
        assert created["id"] == "R-0001"

        run = await client.post(f"/api/v1/rules/{created['id']}/run")
        assert run.status_code == 200
        assert run.json()["rowCount"] == 1

        await client.patch(f"/api/v1/rules/{created['id']}", json={"enabled": False})
        after = {
            r["id"]: r for r in (await client.get("/api/v1/rules")).json()["items"]
        }
        assert after["R-0001"]["enabled"] is False

        await client.delete(f"/api/v1/rules/{created['id']}")
        assert (await client.get("/api/v1/rules")).json()["items"] == []
        await client.post("/api/v1/workspaces/close")
