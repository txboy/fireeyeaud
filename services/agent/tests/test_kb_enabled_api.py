import httpx

from fireeyeaud_agent.main import app


async def test_kb_enabled_scope_merge(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws").mkdir()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            "/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")}
        )
        await client.patch(
            "/api/v1/kb/enabled",
            json={
                "scope": "global",
                "items": [
                    {
                        "providerId": "kb_1",
                        "knowledgeId": "a",
                        "name": "准则",
                        "enabled": True,
                    },
                    {
                        "providerId": "kb_1",
                        "knowledgeId": "b",
                        "name": "税法",
                        "enabled": True,
                    },
                ],
            },
        )
        await client.patch(
            "/api/v1/kb/enabled",
            json={
                "scope": "project",
                "items": [
                    {
                        "providerId": "kb_1",
                        "knowledgeId": "b",
                        "name": "税法",
                        "enabled": False,
                    }
                ],
            },
        )
        effective = (await client.get("/api/v1/kb/enabled")).json()["items"]
        by_key = {(e["providerId"], e["knowledgeId"]): e for e in effective}
        assert by_key[("kb_1", "a")]["enabled"] is True
        assert by_key[("kb_1", "b")]["enabled"] is False
        assert by_key[("kb_1", "b")]["scope"] == "project"

        only_global = (await client.get("/api/v1/kb/enabled?scope=global")).json()[
            "items"
        ]
        assert len(only_global) == 2

        await client.post("/api/v1/workspaces/close")


async def test_kb_enabled_no_workspace():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/v1/kb/enabled")).json()["items"] == []
