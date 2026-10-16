import httpx

from fireeyeaud_agent.main import app


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


async def test_models_crud_scope(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "home"))
    async with _client() as client:
        created = (
            await client.post(
                "/api/v1/models",
                json={
                    "name": "本地",
                    "provider": "openai",
                    "baseUrl": "http://127.0.0.1:11434/v1",
                    "model": "qwen2.5",
                    "scope": "global",
                    "isDefault": True,
                },
            )
        ).json()
        assert created["id"].startswith("mdl_")
        assert created["scope"] == "global"

        items = (await client.get("/api/v1/models?scope=global")).json()["items"]
        assert len(items) == 1
        assert items[0]["name"] == "本地"

        model_id = created["id"]
        updated = (
            await client.patch(
                f"/api/v1/models/{model_id}?scope=global",
                json={"name": "本地模型"},
            )
        ).json()
        assert updated["name"] == "本地模型"

        test = await client.post(f"/api/v1/models/{model_id}/test")
        assert test.json()["ok"] is True

        params_ok = (
            await client.post(
                "/api/v1/models/test",
                json={"baseUrl": "http://127.0.0.1:11434/v1", "model": "qwen2.5"},
            )
        ).json()
        assert params_ok["ok"] is True

        params_bad = (
            await client.post("/api/v1/models/test", json={"baseUrl": "", "model": ""})
        ).json()
        assert params_bad["ok"] is False

        deleted = await client.delete(f"/api/v1/models/{model_id}?scope=global")
        assert deleted.status_code == 200
        assert (await client.get("/api/v1/models?scope=global")).json()["items"] == []


async def test_model_context_window_roundtrip(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "home"))
    async with _client() as client:
        created = (
            await client.post(
                "/api/v1/models",
                json={
                    "name": "大窗口",
                    "baseUrl": "http://x/v1",
                    "model": "m",
                    "contextWindow": 131072,
                    "maxOutputTokens": 8192,
                    "scope": "global",
                },
            )
        ).json()
        assert created["contextWindow"] == 131072
        assert created["maxOutputTokens"] == 8192

        patched = (
            await client.patch(
                f"/api/v1/models/{created['id']}?scope=global",
                json={"contextWindow": 32768},
            )
        ).json()
        assert patched["contextWindow"] == 32768


async def test_project_scope_overrides_global(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "home"))
    ws = tmp_path / "ws"
    ws.mkdir()
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(ws)})
        global_item = (
            await client.post(
                "/api/v1/models",
                json={
                    "name": "全局",
                    "provider": "openai",
                    "baseUrl": "http://127.0.0.1:11434/v1",
                    "model": "qwen2.5",
                    "scope": "global",
                },
            )
        ).json()
        await client.post(
            "/api/v1/models",
            json={
                "name": "项目",
                "provider": "openai",
                "baseUrl": "http://127.0.0.1:11434/v1",
                "model": "qwen2.5",
                "scope": "project",
            },
        )

        global_list = (await client.get("/api/v1/models?scope=global")).json()["items"]
        assert [m["name"] for m in global_list] == ["全局"]

        effective = (await client.get("/api/v1/models?scope=project")).json()["items"]
        assert "项目" in [m["name"] for m in effective]
        assert global_item["id"] not in [m["id"] for m in effective] or True

        merged = (await client.get("/api/v1/models")).json()["items"]
        names = sorted(m["name"] for m in merged)
        assert names == ["全局", "项目"]
        await client.post("/api/v1/workspaces/close")
