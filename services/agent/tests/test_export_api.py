import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store.findings import create_finding


async def test_export_working_paper_api(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        create_finding(
            tmp_path,
            title="t",
            description="d",
            severity="high",
            dataRefs=[],
            sessionId="s_1",
        )
        res = await client.post(
            "/api/v1/export/working-paper",
            json={"format": "word", "locale": "zh-CN"},
        )
        assert res.status_code == 200
        manifest = res.json()
        assert manifest["format"] == "word"
        assert manifest["findingIds"] == ["F-0001"]

        listed = (await client.get("/api/v1/export/working-paper")).json()["items"]
        assert [m["id"] for m in listed] == [manifest["id"]]

        rel = f"{manifest['artifactRef']}/{manifest['files'][0]}"
        art = await client.get(f"/api/v1/artifacts/{rel}")
        assert art.status_code == 200
        assert len(art.content) > 0
        await client.post("/api/v1/workspaces/close")


async def test_export_no_workspace():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/v1/export/working-paper")).json() == {
            "items": []
        }
        res = await client.post("/api/v1/export/working-paper", json={"format": "word"})
        assert res.status_code == 400


async def test_artifacts_rejects_traversal(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        res = await client.get("/api/v1/artifacts/..%2F..%2Fproject.json")
        assert res.status_code in (400, 404)
        await client.post("/api/v1/workspaces/close")
