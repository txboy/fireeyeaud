"""人工疑点与证据路由：创建、软删除、补充/移除证据。"""

from __future__ import annotations

import httpx

from fireeyeaud_agent.main import app


async def _open(client, tmp_path) -> None:
    await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})


async def test_manual_finding_and_evidence_api(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await _open(client, tmp_path)

        created = await client.post(
            "/api/v1/findings",
            json={
                "title": "手工疑点",
                "description": "说明",
                "severity": "high",
                "subjects": ["应收账款"],
                "amount": "1000",
                "author": "张审计",
            },
        )
        assert created.status_code == 201
        body = created.json()
        fid = body["id"]
        assert body["origin"] == "manual"
        assert body["author"] == "张审计"

        src = tmp_path / "回单.pdf"
        src.write_bytes(b"%PDF-1.4 demo")
        added = await client.post(
            f"/api/v1/findings/{fid}/evidence",
            json={
                "kind": "file",
                "title": "银行回单",
                "note": "客户提供",
                "path": str(src),
            },
        )
        assert added.status_code == 201
        ev_id = added.json()["evidence"]["id"]
        assert (tmp_path / "证据" / "回单.pdf").is_file()

        listed = (await client.get(f"/api/v1/findings/{fid}")).json()
        assert listed["evidenceRefs"] == [ev_id]

        removed = await client.delete(f"/api/v1/findings/{fid}/evidence/{ev_id}")
        assert removed.status_code == 200
        assert (await client.get(f"/api/v1/findings/{fid}")).json()["evidenceRefs"] == []
        # 移除只解绑：证据日志仍在
        assert (tmp_path / "证据" / "回单.pdf").is_file()

        deleted = await client.delete(f"/api/v1/findings/{fid}")
        assert deleted.status_code == 200
        assert (await client.get(f"/api/v1/findings/{fid}")).status_code == 404
        items = (await client.get("/api/v1/findings")).json()["items"]
        assert all(i["id"] != fid for i in items)
        await client.post("/api/v1/workspaces/close")


async def test_manual_finding_validation(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await _open(client, tmp_path)
        empty = await client.post("/api/v1/findings", json={"title": "   "})
        assert empty.status_code == 400

        bad = await client.post(
            "/api/v1/findings",
            json={"title": "t", "severity": "nope"},
        )
        assert bad.status_code == 400

        missing = await client.post(
            "/api/v1/findings/F-9999/evidence",
            json={"kind": "text", "title": "x"},
        )
        assert missing.status_code == 404
        await client.post("/api/v1/workspaces/close")


async def test_manual_text_evidence_api(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await _open(client, tmp_path)
        fid = (
            await client.post("/api/v1/findings", json={"title": "t"})
        ).json()["id"]

        res = await client.post(
            f"/api/v1/findings/{fid}/evidence",
            json={"kind": "record", "title": "现场核查", "note": "抽查 10 笔"},
        )
        assert res.status_code == 201
        ev = res.json()["evidence"]
        assert ev["kind"] == "record"
        assert ev["step"] == "manual"

        evidence = (
            await client.get(f"/api/v1/evidence?findingId={fid}")
        ).json()["items"]
        assert evidence[0]["id"] == ev["id"]
        await client.post("/api/v1/workspaces/close")