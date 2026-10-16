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


async def test_settings_compaction_defaults_and_merge(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        default = (await client.get("/api/v1/settings")).json()
        assert default["compaction"] == {
            "auto": True,
            "keepTokens": 15000,
            "reserveOutputTokens": 4096,
            "threshold": 0.9,
        }

        patched = (
            await client.patch(
                "/api/v1/settings", json={"compaction": {"keepTokens": 8000}}
            )
        ).json()
        assert patched["compaction"]["keepTokens"] == 8000
        # 未提供的键保留默认
        assert patched["compaction"]["auto"] is True
        assert patched["compaction"]["threshold"] == 0.9


async def test_settings_skills_mode_default_and_patch(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        default = (await client.get("/api/v1/settings")).json()
        assert default["skills"] == {"mode": "lazy"}

        patched = (
            await client.patch(
                "/api/v1/settings", json={"skills": {"mode": "eager"}}
            )
        ).json()
        assert patched["skills"]["mode"] == "eager"

        again = (await client.get("/api/v1/settings")).json()
        assert again["skills"]["mode"] == "eager"
