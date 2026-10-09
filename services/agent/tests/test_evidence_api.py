import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store.evidence import append_evidence


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


async def test_evidence_list_and_verify(tmp_path) -> None:
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        append_evidence(tmp_path, session_id="s_1", step="tool_call", tool="sql_query")
        append_evidence(
            tmp_path, session_id="s_1", step="tool_result", tool="sql_query"
        )

        items = (await client.get("/api/v1/evidence")).json()["items"]
        assert [e["id"] for e in items] == ["ev_1", "ev_2"]

        ws = (await client.get("/api/v1/workspaces/current")).json()["workspace"]
        report = (
            await client.post(f"/api/v1/workspaces/{ws['id']}/verify-evidence")
        ).json()
        assert report["ok"] is True
        await client.post("/api/v1/workspaces/close")
