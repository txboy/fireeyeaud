"""取证单 API：草稿、大纲、章节、校验、导出、回执与删除。"""

from __future__ import annotations

import httpx
import pytest

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store.findings import create_finding

from test_form_docs import _setup


@pytest.fixture(autouse=True)
def _global_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))


async def test_form_workspace_flow(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})

        created = await client.post(
            "/api/v1/evidence-forms/drafts",
            json={
                "templateId": template_id,
                "templateScope": "project",
                "findingIds": [finding_id],
                "title": "关联方取证单",
            },
        )
        assert created.status_code == 201, created.text
        draft = created.json()
        form_id = draft["manifest"]["id"]
        assert form_id == "QZ-0001"
        assert draft["manifest"]["status"] == "draft"

        doc = (await client.get(f"/api/v1/evidence-forms/{form_id}/doc")).json()
        assert doc["body"]["selectedFindingIds"] == [finding_id]
        assert doc["skeleton"]["templateText"]["blocks"]

        outline = await client.put(
            f"/api/v1/evidence-forms/{form_id}/outline",
            json={
                "approved": True,
                "sections": [{"id": "S1", "title": "一、事项经过", "level": 1}],
            },
        )
        assert outline.status_code == 200

        section = await client.put(
            f"/api/v1/evidence-forms/{form_id}/sections/S1",
            json={
                "blocks": [
                    {
                        "type": "paragraph",
                        "text": "关联方交易未披露。",
                        "sourceRefs": [finding_id],
                    }
                ]
            },
        )
        assert section.status_code == 200

        check = (await client.post(f"/api/v1/evidence-forms/{form_id}/verify")).json()
        assert check["ok"] is True, check["errors"]

        exported = await client.post(f"/api/v1/evidence-forms/{form_id}/export", json={})
        assert exported.status_code == 200
        assert exported.json()["status"] == "saved"
        assert (
            root
            / ".fireeye"
            / "artifacts"
            / "evidence-forms"
            / form_id
            / "document.docx"
        ).is_file()

        listed = (await client.get("/api/v1/evidence-forms")).json()["items"]
        assert [item["id"] for item in listed] == [form_id]

        receipt = tmp_path / "客户签收.pdf"
        receipt.write_bytes(b"%PDF")
        attached = await client.post(
            f"/api/v1/evidence-forms/{form_id}/receipt", json={"path": str(receipt)}
        )
        assert attached.json()["receipt"]["name"] == "客户签收.pdf"
        assert (
            await client.delete(f"/api/v1/evidence-forms/{form_id}/receipt")
        ).json()["receipt"] is None

        assert (await client.delete(f"/api/v1/evidence-forms/{form_id}")).status_code == 200
        assert (await client.get("/api/v1/evidence-forms")).json()["items"] == []
        await client.post("/api/v1/workspaces/close")


async def test_form_findings_endpoint(tmp_path):
    root, template_id, first = _setup(tmp_path)
    second = create_finding(
        root,
        title="服务器采购",
        description="",
        severity="low",
        dataRefs=[],
        sessionId="",
        origin="manual",
    )["id"]
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        created = await client.post(
            "/api/v1/evidence-forms/drafts",
            json={
                "templateId": template_id,
                "templateScope": "project",
                "findingIds": [first],
            },
        )
        form_id = created.json()["manifest"]["id"]
        updated = await client.put(
            f"/api/v1/evidence-forms/{form_id}/findings",
            json={"findingIds": [first, second]},
        )
        assert updated.status_code == 200
        assert updated.json()["selectedFindingIds"] == [first, second]
        doc = (await client.get(f"/api/v1/evidence-forms/{form_id}/doc")).json()
        assert doc["manifest"]["findingCount"] == 2
        await client.post("/api/v1/workspaces/close")


async def test_legacy_preview_routes_are_gone(tmp_path):
    root, template_id, finding_id = _setup(tmp_path)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        response = await client.post(
            "/api/v1/evidence-forms/preview",
            json={
                "templateId": template_id,
                "templateScope": "project",
                "findingIds": [finding_id],
            },
        )
        assert response.status_code in (404, 405)
        await client.post("/api/v1/workspaces/close")


async def test_forms_api_requires_workspace():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/close")
        assert (await client.get("/api/v1/evidence-forms")).status_code == 409
        assert (await client.get("/api/v1/evidence-forms/QZ-0001/doc")).status_code == 409