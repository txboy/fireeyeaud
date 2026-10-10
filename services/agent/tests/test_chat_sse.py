import json

import httpx
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from fireeyeaud_agent.agent import graph as graph_mod
from fireeyeaud_agent.main import app


def _parse_sse(text: str) -> list[dict]:
    events = []
    for line in text.splitlines():
        if line.startswith("data:"):
            events.append(json.loads(line[5:].strip()))
    return events


async def test_chat_streams_sse_envelope(tmp_path, monkeypatch) -> None:
    fake = GenericFakeChatModel(messages=iter([AIMessage(content="你好，这是回答")]))
    monkeypatch.setattr(graph_mod, "build_chat_model", lambda *_a, **_k: fake)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        created = await client.post("/api/v1/sessions", json={"title": "t"})
        assert created.status_code == 200
        session_id = created.json()["id"]

        async with client.stream(
            "POST",
            f"/api/v1/sessions/{session_id}/chat",
            json={"message": "你好", "locale": "zh-CN"},
        ) as resp:
            assert resp.status_code == 200
            text = "".join([chunk async for chunk in resp.aiter_text()])
        await client.post("/api/v1/workspaces/close")

    events = _parse_sse(text)
    types = [e["type"] for e in events]

    assert types[0] == "status"
    assert "token" in types
    assert types[-1] == "done"
    assert all(e["sessionId"] == session_id for e in events)
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))

    streamed = "".join(e["data"]["delta"] for e in events if e["type"] == "token")
    assert "你好" in streamed
    assert "这是回答" in streamed
