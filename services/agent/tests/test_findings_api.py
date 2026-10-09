import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store.findings import create_finding


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


async def test_list_findings(tmp_path) -> None:
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        create_finding(
            tmp_path,
            title="t1",
            description="d",
            severity="high",
            dataRefs=[],
            sessionId="s_1",
        )
        resp = await client.get("/api/v1/findings")
        body = resp.json()
        assert body["items"][0]["id"] == "F-0001"
        assert body["items"][0]["status"] == "pending"
        await client.post("/api/v1/workspaces/close")


async def test_get_finding_detail(tmp_path) -> None:
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        create_finding(
            tmp_path,
            title="t1",
            description="d",
            severity="medium",
            dataRefs=[],
            sessionId="s_1",
        )
        resp = await client.get("/api/v1/findings/F-0001")
        assert resp.status_code == 200
        assert resp.json()["severity"] == "medium"
        missing = await client.get("/api/v1/findings/F-9999")
        assert missing.status_code == 404
        await client.post("/api/v1/workspaces/close")


async def test_filter_by_severity(tmp_path) -> None:
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        create_finding(
            tmp_path,
            title="a",
            description="d",
            severity="high",
            dataRefs=[],
            sessionId="s_1",
        )
        create_finding(
            tmp_path,
            title="b",
            description="d",
            severity="low",
            dataRefs=[],
            sessionId="s_1",
        )
        body = (await client.get("/api/v1/findings?severity=high")).json()
        assert [i["id"] for i in body["items"]] == ["F-0001"]
        await client.post("/api/v1/workspaces/close")
