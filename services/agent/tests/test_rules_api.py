import httpx

from fireeyeaud_agent.main import app


async def test_rules_api_crud_and_run(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        items = (await client.get("/api/v1/rules")).json()["items"]
        assert any(r["id"] == "tie_check" for r in items)

        created = (
            await client.post(
                "/api/v1/rules",
                json={
                    "name": "非零",
                    "type": "sql",
                    "severity": "high",
                    "definition": "SELECT 1",
                },
            )
        ).json()
        assert created["id"] == "R-0001"

        await client.patch(f"/api/v1/rules/{created['id']}", json={"enabled": False})
        after = {
            r["id"]: r for r in (await client.get("/api/v1/rules")).json()["items"]
        }
        assert after["R-0001"]["enabled"] is False

        not_runnable = await client.post("/api/v1/rules/related_party_undisclosed/run")
        assert not_runnable.status_code == 400

        await client.delete(f"/api/v1/rules/{created['id']}")
        remaining = {
            r["id"] for r in (await client.get("/api/v1/rules")).json()["items"]
        }
        assert "R-0001" not in remaining
        await client.post("/api/v1/workspaces/close")
