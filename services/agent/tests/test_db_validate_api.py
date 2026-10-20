"""数据库 SQL 纯语法校验路由。"""

import httpx

from fireeyeaud_agent.main import app


async def test_db_validate_sql_syntax_error(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        res = await client.post(
            "/api/v1/db/validate-sql",
            json={"driver": "sqlite", "sql": "SELEC * FROM t"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["ok"] is False
        assert body["errors"][0]["from"] == 0


async def test_db_validate_sql_syntax_ok(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        res = await client.post(
            "/api/v1/db/validate-sql",
            json={"driver": "sqlite", "sql": "SELECT 1"},
        )
        assert res.status_code == 200
        assert res.json() == {"ok": True, "errors": []}
