import httpx

from fireeyeaud_agent.main import app


async def test_settings_defaults_and_patch(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        default = (await client.get("/api/v1/settings")).json()
        assert default["locale"] == "zh-CN"
        assert default["theme"] == "light"
        assert default["telemetry"] is False
        assert default["webSearch"]["enabled"] is False

        res = await client.patch(
            "/api/v1/settings",
            json={
                "theme": "dark",
                "webSearch": {"enabled": True, "provider": "tavily"},
            },
        )
        body = res.json()
        assert body["theme"] == "dark"
        assert body["webSearch"]["enabled"] is True
        assert body["webSearch"]["provider"] == "tavily"
        assert body["telemetry"] is False

        again = (await client.get("/api/v1/settings")).json()
        assert again["theme"] == "dark"
        assert again["webSearch"]["enabled"] is True
