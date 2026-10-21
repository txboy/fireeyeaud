"""SQL 助手流式路由：事件顺序、错误透出、以及「不碰数据库」的边界。"""

from __future__ import annotations

import json

import httpx
from langchain_core.messages import AIMessage, AIMessageChunk

from fake_model import FakeChatModel

from fireeyeaud_agent.agent import sql_assistant as sql_assistant_mod
from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.main import app
from fireeyeaud_agent.store import db as db_store
from fireeyeaud_agent.store import db_engine


def _parse_sse(text: str) -> list[dict]:
    events = []
    for line in text.splitlines():
        if line.startswith("data:"):
            events.append(json.loads(line[5:].strip()))
    return events


def _body(connection_id: str, **overrides) -> dict:
    body = {
        "scope": "project",
        "connectionId": connection_id,
        "table": "voucher",
        "driver": "sqlite",
        "messages": [{"role": "user", "content": "统计各科目金额"}],
        "context": {
            "connection": {"id": connection_id, "name": "本地", "driver": "sqlite", "database": None},
            "table": {"name": "voucher", "columns": [{"name": "id", "type": "INTEGER"}]},
            "tables": [],
            "tablesTruncated": False,
            "currentSql": "SELECT * FROM voucher",
            "executedSql": None,
            "result": None,
            "resultTruncated": False,
            "error": None,
            "page": 1,
            "pageSize": 50,
            "total": None,
        },
        "locale": "zh-CN",
    }
    body.update(overrides)
    return body


async def _open(client, tmp_path, with_conn: bool = True) -> dict | None:
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True, exist_ok=True)
    await client.post("/api/v1/workspaces/open", json={"path": str(root)})
    if not with_conn:
        return None
    return (
        await client.post(
            "/api/v1/db/connections",
            json={"name": "本地", "driver": "sqlite", "path": str(tmp_path / "x.db"), "scope": "project"},
        )
    ).json()


async def test_sql_chat_requires_workspace(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/close")
        res = await client.post("/api/v1/db/sql-chat", json=_body("c1"))
        assert res.status_code == 409


async def test_sql_chat_unknown_connection_is_404(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await _open(client, tmp_path, with_conn=False)
        res = await client.post("/api/v1/db/sql-chat", json=_body("nope"))
        assert res.status_code == 404
        await client.post("/api/v1/workspaces/close")


async def test_sql_chat_streams_status_tokens_done(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    fake = FakeChatModel(
        messages=iter([AIMessage(content="可以使用：\n```sql\nSELECT 1\n```")])
    )
    monkeypatch.setattr(sql_assistant_mod, "build_chat_model", lambda *_a, **_k: fake, raising=False)
    import fireeyeaud_agent.config.models as models_mod

    monkeypatch.setattr(models_mod, "build_chat_model", lambda *_a, **_k: fake)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conn = await _open(client, tmp_path)
        async with client.stream(
            "POST", "/api/v1/db/sql-chat", json=_body(conn["id"])
        ) as resp:
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("text/event-stream")
            text = "".join([chunk async for chunk in resp.aiter_text()])
        await client.post("/api/v1/workspaces/close")

    events = _parse_sse(text)
    types = [e["type"] for e in events]
    assert types[0] == "status"
    assert types[-1] == "done"
    assert "token" in types
    assert all(t in ("status", "token", "done") for t in types)
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    streamed = "".join(e["data"]["delta"] for e in events if e["type"] == "token")
    assert "SELECT 1" in streamed


async def test_sql_chat_surfaces_api_error_as_event(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    import fireeyeaud_agent.config.models as models_mod

    def boom(*_a, **_k):
        raise ApiError("E_LLM_UNAVAILABLE", 503, "error.llmUnavailable")

    monkeypatch.setattr(models_mod, "build_chat_model", boom)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conn = await _open(client, tmp_path)
        async with client.stream(
            "POST", "/api/v1/db/sql-chat", json=_body(conn["id"])
        ) as resp:
            assert resp.status_code == 200
            text = "".join([chunk async for chunk in resp.aiter_text()])
        await client.post("/api/v1/workspaces/close")

    events = _parse_sse(text)
    assert events[-1]["type"] == "error"
    assert events[-1]["data"]["messageKey"] == "error.llmUnavailable"


async def test_sql_chat_never_touches_the_database(tmp_path, monkeypatch) -> None:
    """安全边界：路由不取凭据、不连库、不查数。"""
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    fake = FakeChatModel(messages=iter([AIMessage(content="ok")]))
    import fireeyeaud_agent.config.models as models_mod

    monkeypatch.setattr(models_mod, "build_chat_model", lambda *_a, **_k: fake)

    calls: list[str] = []

    def secret(*_a, **_k):
        calls.append("get_secret")
        raise AssertionError("sql-chat must not read secrets")

    def run_query(*_a, **_k):
        calls.append("run_query")
        raise AssertionError("sql-chat must not run queries")

    monkeypatch.setattr(db_store, "get_secret", secret)
    monkeypatch.setattr(db_engine, "run_query", run_query)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conn = await _open(client, tmp_path)
        async with client.stream(
            "POST", "/api/v1/db/sql-chat", json=_body(conn["id"])
        ) as resp:
            assert resp.status_code == 200
            _ = "".join([chunk async for chunk in resp.aiter_text()])
        await client.post("/api/v1/workspaces/close")

    assert calls == []


async def test_sql_chat_truncates_oversized_messages(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    seen: list = []

    class Capturing:
        async def astream(self, messages):
            seen.extend(messages)
            yield AIMessageChunk(content="ok")

    import fireeyeaud_agent.config.models as models_mod

    monkeypatch.setattr(models_mod, "build_chat_model", lambda *_a, **_k: Capturing())

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conn = await _open(client, tmp_path)
        messages = [
            {"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"}
            for i in range(100)
        ]
        async with client.stream(
            "POST", "/api/v1/db/sql-chat", json=_body(conn["id"], messages=messages)
        ) as resp:
            assert resp.status_code == 200
            _ = "".join([chunk async for chunk in resp.aiter_text()])
        await client.post("/api/v1/workspaces/close")

    # system + 最近 40 条
    assert len(seen) == 41
    assert seen[0].type == "system"
    assert seen[-1].content == "m99"


async def test_sql_chat_uses_server_side_driver(tmp_path, monkeypatch) -> None:
    """请求里的 driver 若与服务端连接记录不符，以服务端为准（不信任前端）。"""
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    captured: dict = {}

    class Capturing:
        async def astream(self, messages):
            captured["system"] = messages[0].content
            yield AIMessageChunk(content="ok")

    import fireeyeaud_agent.config.models as models_mod

    monkeypatch.setattr(models_mod, "build_chat_model", lambda *_a, **_k: Capturing())

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        conn = await _open(client, tmp_path)
        body = _body(conn["id"])
        body["driver"] = "oracle"  # 撒谎：服务端记录是 sqlite
        body["context"]["connection"]["driver"] = "oracle"
        async with client.stream("POST", "/api/v1/db/sql-chat", json=body) as resp:
            assert resp.status_code == 200
            _ = "".join([chunk async for chunk in resp.aiter_text()])
        await client.post("/api/v1/workspaces/close")

    assert "SQLite" in captured["system"]
    assert "Oracle（PL/SQL）" not in captured["system"].split("## 上下文")[0]