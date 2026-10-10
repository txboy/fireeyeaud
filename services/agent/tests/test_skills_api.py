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
        items = (await client.get("/api/v1/skills")).json()["items"]
        assert any(s["builtin"] for s in items)

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
        skill = res.json()
        assert skill["id"] == "sk_1"
        assert skill["builtin"] is False

        builtin = await client.delete(
            "/api/v1/skills/sk_builtin_going_concern?scope=project"
        )
        assert builtin.status_code == 400

        await client.delete("/api/v1/skills/sk_1?scope=project")
        await client.post("/api/v1/workspaces/close")
