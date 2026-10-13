import httpx

from fireeyeaud_agent.main import app


async def test_skills_api(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws").mkdir()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            "/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")}
        )
        assert (await client.get("/api/v1/skills")).json()["items"] == []

        res = await client.post(
            "/api/v1/skills",
            json={
                "name": "舞弊聚焦",
                "prompt": "关注收入虚增。",
                "toolIds": ["sql_query"],
                "enabled": True,
                "scope": "project",
            },
        )
        assert res.status_code == 200
        assert res.json()["id"] == "sk_1"

        await client.delete("/api/v1/skills/sk_1?scope=project")
        assert (await client.get("/api/v1/skills")).json()["items"] == []
        await client.post("/api/v1/workspaces/close")
