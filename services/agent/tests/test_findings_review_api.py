import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store.findings import create_finding


async def test_review_api(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        fid = create_finding(
            tmp_path,
            title="t",
            description="d",
            severity="high",
            dataRefs=[],
            sessionId="s_1",
        )["id"]
        res = await client.post(
            f"/api/v1/findings/{fid}/review",
            json={"action": "confirm", "reviewer": "审计员", "comment": "ok"},
        )
        assert res.status_code == 200
        detail = (await client.get(f"/api/v1/findings/{fid}")).json()
        assert detail["status"] == "confirmed"
        assert detail["reviews"][0]["reviewer"] == "审计员"

        missing = await client.post(
            "/api/v1/findings/F-9999/review", json={"action": "confirm"}
        )
        assert missing.status_code == 404
        await client.post("/api/v1/workspaces/close")
