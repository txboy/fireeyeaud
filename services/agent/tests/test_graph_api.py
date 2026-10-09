import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store.findings import create_finding


async def test_graph_api(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        create_finding(
            tmp_path,
            title="t",
            description="d",
            severity="high",
            dataRefs=[{"sourceId": "ds_1", "table": "t1", "rowRef": "1"}],
            sessionId="s_1",
        )
        graph = (await client.get("/api/v1/graph")).json()
        assert any(n["id"] == "finding:F-0001" for n in graph["nodes"])
        assert any(e["edgeType"] == "derived_from" for e in graph["edges"])

        sub = (await client.get("/api/v1/graph?findingId=F-0001")).json()
        assert {n["nodeType"] for n in sub["nodes"]} <= {
            "finding",
            "dataset",
            "voucher",
        }
        await client.post("/api/v1/workspaces/close")


async def test_graph_api_no_workspace():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/v1/graph")).json() == {"nodes": [], "edges": []}
