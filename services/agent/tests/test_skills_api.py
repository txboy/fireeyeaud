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


async def test_skills_api_lazy_fields(tmp_path, monkeypatch):
    """T1：description / whenToUse / eager 可创建、可回读、可 PATCH。"""
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws").mkdir()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            "/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")}
        )
        res = await client.post(
            "/api/v1/skills",
            json={
                "name": "收入舞弊",
                "prompt": "识别收入确认异常。",
                "description": "识别收入确认异常与截止性测试思路。",
                "whenToUse": "分析收入科目时。",
                "eager": True,
                "enabled": True,
                "scope": "project",
            },
        )
        assert res.status_code == 200
        created = res.json()
        assert created["description"] == "识别收入确认异常与截止性测试思路。"
        assert created["whenToUse"] == "分析收入科目时。"
        assert created["eager"] is True

        sk_id = created["id"]
        items = (await client.get("/api/v1/skills")).json()["items"]
        assert items[0]["description"] == "识别收入确认异常与截止性测试思路。"
        assert items[0]["eager"] is True

        patched = await client.patch(
            f"/api/v1/skills/{sk_id}?scope=project",
            json={"description": "改写后的描述", "eager": False},
        )
        assert patched.status_code == 200
        assert patched.json()["description"] == "改写后的描述"
        assert patched.json()["eager"] is False
        assert patched.json()["whenToUse"] == "分析收入科目时。"
        await client.post("/api/v1/workspaces/close")
