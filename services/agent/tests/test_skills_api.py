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


async def test_skills_api_can_clear_lazy_fields(tmp_path, monkeypatch):
    """清空 description/whenToUse：空字符串会被写入并回读（前端清空字段以此为准）。

    None 会被 store 的 drop_none 忽略，因此清空必须用空字符串而非 null。
    """
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws").mkdir()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            "/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")}
        )
        created = (
            await client.post(
                "/api/v1/skills",
                json={
                    "name": "A",
                    "prompt": "正文",
                    "description": "原描述",
                    "whenToUse": "原场景",
                    "enabled": True,
                    "scope": "project",
                },
            )
        ).json()
        sk_id = created["id"]

        cleared = (
            await client.patch(
                f"/api/v1/skills/{sk_id}?scope=project",
                json={"description": "", "whenToUse": ""},
            )
        ).json()
        assert cleared["description"] == ""
        assert cleared["whenToUse"] == ""

        items = (await client.get("/api/v1/skills")).json()["items"]
        assert items[0]["description"] == ""
        assert items[0]["whenToUse"] == ""
        await client.post("/api/v1/workspaces/close")
