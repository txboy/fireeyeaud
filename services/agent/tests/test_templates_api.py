"""模板路由：双作用域、上传、改名、设默认、内容/文件、复制、删除。"""

from __future__ import annotations

import base64

import httpx
from docx import Document

from fireeyeaud_agent.main import app


def _docx(path, text="项目名称：{{项目名称}}\n取证单编号：{{取证单编号}}"):
    doc = Document()
    for line in text.split("\n"):
        doc.add_paragraph(line)
    doc.save(path)
    return path


async def test_scoped_templates_api(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "project"
    root.mkdir()
    src = _docx(tmp_path / "标准取证单.docx")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})

        uploaded = await client.post(
            "/api/v1/templates",
            json={
                "kind": "evidence-form",
                "paths": [str(src)],
                "scope": "project",
                "isDefault": True,
            },
        )
        assert uploaded.status_code == 201
        item = uploaded.json()["items"][0]
        assert item["scope"] == "project"
        assert item["name"] == "标准取证单"
        assert item["isDefault"] is True

        listed = (await client.get("/api/v1/templates?kind=evidence-form")).json()
        assert any(i["id"] == item["id"] for i in listed["items"])

        # 全局列表不包含项目项
        only_global = (
            await client.get("/api/v1/templates?kind=evidence-form&scope=global")
        ).json()
        assert all(i["scope"] == "global" for i in only_global["items"])

        patched = await client.patch(
            f"/api/v1/templates/{item['id']}?scope=project",
            json={"name": "改名", "isDefault": True},
        )
        assert patched.status_code == 200
        assert patched.json()["name"] == "改名"

        content = await client.get(
            f"/api/v1/templates/{item['id']}/content?scope=project"
        )
        assert content.status_code == 200
        assert content.json()["kind"] == "base64"
        assert content.json()["data"]
        assert base64.b64decode(content.json()["data"])[:2] == b"PK"

        file_res = await client.get(
            f"/api/v1/templates/{item['id']}/file?scope=project"
        )
        assert file_res.status_code == 200
        assert file_res.headers["content-type"].startswith(
            "application/vnd.openxmlformats"
        )

        sample = (await client.get("/api/v1/templates?kind=report")).json()
        sample_id = next(i["id"] for i in sample["items"] if i["builtin"])
        copied = await client.post(
            f"/api/v1/templates/{sample_id}/duplicate",
            json={"scope": "project"},
        )
        assert copied.status_code == 201
        assert copied.json()["builtin"] is False
        assert copied.json()["scope"] == "project"

        deleted = await client.delete(f"/api/v1/templates/{item['id']}?scope=project")
        assert deleted.status_code == 200

        await client.post("/api/v1/workspaces/close")


async def test_templates_api_works_without_workspace_for_global(tmp_path, monkeypatch):
    """没有打开项目时仍可管理/预览全局模板（计划 §0）。"""
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    src = _docx(tmp_path / "全局.docx")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/close")

        listed = await client.get("/api/v1/templates?kind=report")
        assert listed.status_code == 200
        sample_id = next(i["id"] for i in listed.json()["items"] if i["builtin"])
        content = await client.get(f"/api/v1/templates/{sample_id}/content")
        assert content.status_code == 200

        uploaded = await client.post(
            "/api/v1/templates",
            json={"kind": "report", "paths": [str(src)], "scope": "global"},
        )
        assert uploaded.status_code == 201
        assert uploaded.json()["items"][0]["scope"] == "global"

        # 项目作用域必须有工作区
        rejected = await client.post(
            "/api/v1/templates",
            json={"kind": "report", "paths": [str(src)], "scope": "project"},
        )
        assert rejected.status_code == 409


async def test_upload_multiple_files_names_from_files(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "project"
    root.mkdir()
    a = _docx(tmp_path / "模板甲.docx")
    b = _docx(tmp_path / "模板乙.docx")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        res = await client.post(
            "/api/v1/templates",
            json={
                "kind": "report",
                "paths": [str(a), str(b)],
                "scope": "project",
                "name": "忽略我",
                "isDefault": True,
            },
        )
        assert res.status_code == 201
        items = res.json()["items"]
        assert [i["name"] for i in items] == ["模板甲", "模板乙"]
        # 多选时只有第一份成为默认
        assert [i["id"] for i in items if i["isDefault"]] == [items[0]["id"]]
        await client.post("/api/v1/workspaces/close")


async def test_builtin_cannot_be_deleted_or_patched(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        listed = (await client.get("/api/v1/templates?kind=report")).json()
        sample = next(i for i in listed["items"] if i["builtin"])
        deleted = await client.delete(f"/api/v1/templates/{sample['id']}?scope=global")
        assert deleted.status_code == 403
        patched = await client.patch(
            f"/api/v1/templates/{sample['id']}?scope=global", json={"name": "x"}
        )
        assert patched.status_code == 403


async def test_unknown_template_is_404(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (
            await client.get("/api/v1/templates/nope/content?scope=global")
        ).status_code == 404
        assert (
            await client.delete("/api/v1/templates/nope?scope=global")
        ).status_code == 404


async def test_upload_bad_file_returns_400(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "project"
    root.mkdir()
    bad = tmp_path / "x.txt"
    bad.write_text("hi", "utf-8")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        res = await client.post(
            "/api/v1/templates",
            json={"kind": "report", "paths": [str(bad)], "scope": "project"},
        )
        assert res.status_code == 400
        await client.post("/api/v1/workspaces/close")


async def test_patch_can_move_scope(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "project"
    root.mkdir()
    src = _docx(tmp_path / "p.docx")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        item = (
            await client.post(
                "/api/v1/templates",
                json={"kind": "report", "paths": [str(src)], "scope": "project"},
            )
        ).json()["items"][0]

        moved = await client.patch(
            f"/api/v1/templates/{item['id']}?scope=project",
            json={"scope": "global"},
        )
        assert moved.status_code == 200
        assert moved.json()["scope"] == "global"

        listed = (await client.get("/api/v1/templates?kind=report&scope=project")).json()
        assert all(i["id"] != item["id"] for i in listed["items"])
        await client.post("/api/v1/workspaces/close")


async def test_inspect_reads_a_local_docx_without_saving(tmp_path, monkeypatch):
    """新增模板时下半部分预览用：只读检查本地文件，不写清单、不落盘。"""
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    src = _docx(tmp_path / "待添加.docx")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        res = await client.post(
            "/api/v1/templates/inspect",
            json={"path": str(src), "kind": "report"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["name"] == "待添加"
        assert body["kind"] == "base64"
        assert base64.b64decode(body["data"])[:2] == b"PK"
        assert "报告编号" in body["check"]["missing"] or body["check"]["missing"]
        assert body["check"]["tags"]

        # 没有产生任何模板记录
        listed = (await client.get("/api/v1/templates?kind=report")).json()
        assert all(i.get("builtin") for i in listed["items"])


async def test_inspect_rejects_missing_and_non_docx(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    bad = tmp_path / "x.txt"
    bad.write_text("hi", "utf-8")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        missing = await client.post(
            "/api/v1/templates/inspect",
            json={"path": str(tmp_path / "nope.docx"), "kind": "report"},
        )
        assert missing.status_code == 404
        wrong = await client.post(
            "/api/v1/templates/inspect",
            json={"path": str(bad), "kind": "report"},
        )
        assert wrong.status_code == 400