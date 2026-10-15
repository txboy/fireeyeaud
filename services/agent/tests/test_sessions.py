from pathlib import Path

import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store import sessions


def _ws(tmp_path, monkeypatch) -> Path:
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)
    return root


def test_session_context_roundtrip(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    fe = root / ".fireeye"
    session = sessions.create_session(fe, root, None)

    assert sessions.update_session_context(
        fe, session["id"], {"ruleIds": ["rule_1"]}, "mdl_1"
    )

    items = sessions.list_sessions(fe)
    assert items[0]["context"] == {"ruleIds": ["rule_1"]}
    assert items[0]["modelId"] == "mdl_1"


async def test_session_context_api(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        sid = (await client.post("/api/v1/sessions", json={"title": None})).json()["id"]

        res = await client.patch(
            f"/api/v1/sessions/{sid}/context",
            json={
                "context": {"ruleIds": ["rule_1"], "dbConnectionIds": []},
                "modelId": "mdl_1",
            },
        )
        assert res.json() == {"ok": True}

        listed = (await client.get("/api/v1/sessions")).json()["items"]
        assert listed[0]["context"] == {"ruleIds": ["rule_1"], "dbConnectionIds": []}
        assert listed[0]["modelId"] == "mdl_1"
        await client.post("/api/v1/workspaces/close")


async def test_rules_is_default_api(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        created = (
            await client.post(
                "/api/v1/rules",
                json={
                    "name": "R",
                    "sql": "select 1",
                    "isDefault": True,
                    "scope": "project",
                },
            )
        ).json()
        assert created["isDefault"] is True

        patched = (
            await client.patch(
                f"/api/v1/rules/{created['id']}?scope=project",
                json={"isDefault": False},
            )
        ).json()
        assert patched["isDefault"] is False
        await client.post("/api/v1/workspaces/close")
