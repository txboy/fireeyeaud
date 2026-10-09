import json

import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store import workspace as ws_mod


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


async def test_open_current_close(tmp_path) -> None:
    async with _client() as client:
        resp = await client.post(
            "/api/v1/workspaces/open", json={"path": str(tmp_path)}
        )
        assert resp.status_code == 200, resp.text
        ws = resp.json()
        assert ws["schemaVersion"] == 1
        assert ws["name"] == tmp_path.name
        assert (tmp_path / ".fireeye" / "project.json").exists()
        assert (tmp_path / ".fireeye" / ".lock").exists()
        for sub in ("config", "templates", "index", "artifacts"):
            assert (tmp_path / ".fireeye" / sub).is_dir()

        current = (await client.get("/api/v1/workspaces/current")).json()["workspace"]
        assert current["id"] == ws["id"]
        assert ws_mod.workspace_manager.db is not None

        closed = (await client.post("/api/v1/workspaces/close")).json()
        assert closed["closed"] is True
        assert not (tmp_path / ".fireeye" / ".lock").exists()
        assert ws_mod.workspace_manager.db is None
        assert (await client.get("/api/v1/workspaces/current")).json()[
            "workspace"
        ] is None


async def test_path_invalid(tmp_path) -> None:
    async with _client() as client:
        resp = await client.post(
            "/api/v1/workspaces/open", json={"path": str(tmp_path / "nope")}
        )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "E_PATH_INVALID"


async def test_open_locked(tmp_path, monkeypatch) -> None:
    fe = tmp_path / ".fireeye"
    fe.mkdir()
    (fe / "project.json").write_text(json.dumps({"schemaVersion": 1}), "utf-8")
    (fe / ".lock").write_text(json.dumps({"pid": 999999, "port": 1}), "utf-8")
    monkeypatch.setattr(ws_mod, "_pid_alive", lambda pid: True)

    async with _client() as client:
        resp = await client.post(
            "/api/v1/workspaces/open", json={"path": str(tmp_path)}
        )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "E_WS_LOCKED"


async def test_open_reports_evidence_status(tmp_path) -> None:
    from fireeyeaud_agent.store.evidence import append_evidence

    async with _client() as client:
        opened = (
            await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        ).json()
        assert opened["evidence"]["ok"] is True
        append_evidence(tmp_path, session_id="s_1", step="tool_call", tool="x")
        await client.post("/api/v1/workspaces/close")

        reopened = (
            await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        ).json()
        assert reopened["evidence"]["ok"] is True
        assert reopened["evidence"]["count"] == 1
        await client.post("/api/v1/workspaces/close")


async def test_schema_too_new(tmp_path) -> None:
    fe = tmp_path / ".fireeye"
    fe.mkdir()
    (fe / "project.json").write_text(json.dumps({"schemaVersion": 999}), "utf-8")

    async with _client() as client:
        resp = await client.post(
            "/api/v1/workspaces/open", json={"path": str(tmp_path)}
        )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "E_WS_SCHEMA_TOO_NEW"
