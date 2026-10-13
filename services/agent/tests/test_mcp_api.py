import httpx

from fireeyeaud_agent.main import app


async def test_mcp_api(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws").mkdir()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            "/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")}
        )
        res = await client.post(
            "/api/v1/mcp/servers",
            json={
                "name": "filesystem",
                "transport": "stdio",
                "command": "npx",
                "args": ["-y", "server-filesystem", "."],
                "env": {"LOG_LEVEL": "info"},
                "apiKeyRef": "sec_1",
                "apiKeyEnv": "FS_API_KEY",
                "enabled": True,
                "scope": "project",
            },
        )
        assert res.status_code == 200
        body = res.json()
        assert body["id"] == "mcp_1"
        assert body["env"] == {"LOG_LEVEL": "info"}
        assert body["apiKeyRef"] == "sec_1"
        assert body["apiKeyEnv"] == "FS_API_KEY"
        listed = (await client.get("/api/v1/mcp/servers")).json()["items"]
        assert listed[0]["name"] == "filesystem"

        patched = await client.patch(
            "/api/v1/mcp/servers/mcp_1?scope=project",
            json={"enabled": False, "apiKeyEnv": "OTHER_KEY"},
        )
        assert patched.json()["enabled"] is False
        assert patched.json()["apiKeyEnv"] == "OTHER_KEY"

        await client.delete("/api/v1/mcp/servers/mcp_1?scope=project")
        await client.post("/api/v1/workspaces/close")


async def test_mcp_no_workspace():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/v1/mcp/servers")).json()["items"] == []
