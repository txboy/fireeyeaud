"""项目归档路由：状态、归档、历史、远程、推送、冲突、clone/restore。"""

from __future__ import annotations

from pathlib import Path

import httpx
from dulwich import porcelain

from fireeyeaud_agent.main import app


def _project(path: Path) -> Path:
    fe = path / ".fireeye"
    (fe / "artifacts").mkdir(parents=True)
    (fe / "project.json").write_text('{"name":"P","counters":{}}', "utf-8")
    (fe / "findings.jsonl").write_text("", "utf-8")
    (path / "证据").mkdir()
    (path / "证据" / "a.txt").write_text("x", "utf-8")
    return path


async def test_archive_api_flow(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = _project(tmp_path / "ws")
    remote = tmp_path / "remote.git"
    porcelain.init(str(remote), bare=True)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})

        status = (await client.get("/api/v1/archive/status")).json()
        assert status["initialized"] is False

        assert (await client.post("/api/v1/archive/init")).status_code == 200

        committed = await client.post(
            "/api/v1/archive/commit", json={"message": "首次归档"}
        )
        assert committed.status_code == 200
        body = committed.json()
        assert body["id"] == "A-0001"
        assert body["tag"] == "archive/A-0001"
        assert len(body["commit"]) == 40

        history = (await client.get("/api/v1/archive/history")).json()["items"]
        assert [i["id"] for i in history] == ["A-0001"]
        assert history[0]["manifest"]["counts"]["findings"] == 0

        changes = (
            await client.get("/api/v1/archive/A-0001/changes")
        ).json()["items"]
        assert any(c["path"] == "证据/a.txt" for c in changes)

        saved = await client.post(
            "/api/v1/archive/remote",
            json={"url": str(remote), "username": "", "autoPush": False},
        )
        assert saved.status_code == 200
        assert saved.json()["remoteUrl"] == str(remote)

        pushed = await client.post(
            "/api/v1/archive/push", json={"archiveId": "A-0001"}
        )
        assert pushed.status_code == 200
        assert pushed.json()["ok"] is True
        assert (remote / "refs" / "tags" / "archive" / "A-0001").is_file()

        check = (await client.post("/api/v1/archive/conflict/check")).json()
        assert check["diverged"] is False

        status_after = (await client.get("/api/v1/archive/status")).json()
        assert status_after["initialized"] is True
        # 保存远程配置会改动 .fireeye/config/archive.json（已跟踪文件），所以此时是脏的
        assert status_after["dirty"] is True
        assert any("archive.json" in path for path in status_after["changed"])
        assert status_after["canPush"] is True
        assert status_after["remote"]["remoteUrl"] == str(remote)

        # 再归档一次后恢复干净
        await client.post("/api/v1/archive/commit", json={"message": "记录远程配置"})
        clean = (await client.get("/api/v1/archive/status")).json()
        assert clean["dirty"] is False
        assert clean["lastArchive"] == "A-0002"

        await client.post("/api/v1/workspaces/close")


async def test_archive_api_requires_workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/close")
        assert (await client.get("/api/v1/archive/status")).status_code == 409
        assert (
            await client.post("/api/v1/archive/commit", json={})
        ).status_code == 409


async def test_archive_errors(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = _project(tmp_path / "ws")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})

        # 没有变更 → 409
        await client.post("/api/v1/archive/init")
        await client.post("/api/v1/archive/commit", json={})
        again = await client.post("/api/v1/archive/commit", json={})
        assert again.status_code == 409
        assert again.json()["error"]["messageKey"] == "error.nothingToArchive"

        # 没有远程 → 409
        no_remote = await client.post("/api/v1/archive/push", json={})
        assert no_remote.status_code == 409
        assert no_remote.json()["error"]["messageKey"] == "error.noRemote"

        # 不存在的归档
        assert (
            await client.get("/api/v1/archive/A-9999/changes")
        ).status_code == 404
        await client.post("/api/v1/workspaces/close")


async def test_clone_api(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = _project(tmp_path / "ws")
    remote = tmp_path / "remote.git"
    porcelain.init(str(remote), bare=True)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        await client.post("/api/v1/archive/init")
        await client.post("/api/v1/archive/commit", json={})
        await client.post("/api/v1/archive/remote", json={"url": str(remote)})
        await client.post("/api/v1/archive/push", json={})
        await client.post("/api/v1/workspaces/close")

        target = tmp_path / "cloned"
        cloned = await client.post(
            "/api/v1/archive/clone",
            json={"url": str(remote), "targetDir": str(target)},
        )
        assert cloned.status_code == 200
        assert (target / ".fireeye" / "project.json").is_file()
        await client.post("/api/v1/workspaces/close")