import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store import secrets


async def test_secrets_push_and_get(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    secrets.clear()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        res = await client.post("/api/v1/secrets", json={"items": {"sec_1": "p@ss"}})
        assert res.status_code == 200
        assert res.json()["count"] == 1
        assert secrets.get("sec_1") == "p@ss"

        # 全量替换
        await client.post("/api/v1/secrets", json={"items": {"sec_2": "x"}})
        assert secrets.get("sec_1") is None
        assert secrets.get("sec_2") == "x"
    secrets.clear()


def test_secrets_set_one_and_remove():
    secrets.clear()
    secrets.set_one("sec_a", "v")
    assert secrets.get("sec_a") == "v"
    secrets.remove("sec_a")
    assert secrets.get("sec_a") is None
    secrets.clear()
