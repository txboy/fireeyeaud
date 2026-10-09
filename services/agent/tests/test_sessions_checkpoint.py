import httpx
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from fireeyeaud_agent.agent import graph as graph_mod
from fireeyeaud_agent.main import app


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


async def test_session_messages_persisted(tmp_path, monkeypatch) -> None:
    answers = iter([AIMessage(content="第一次回答"), AIMessage(content="第二次回答")])
    monkeypatch.setattr(
        graph_mod, "build_chat_model", lambda: GenericFakeChatModel(messages=answers)
    )

    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        created = await client.post("/api/v1/sessions", json={"title": "会话"})
        session_id = created.json()["id"]
        assert session_id.startswith("s_")

        for question in ["问题一", "问题二"]:
            async with client.stream(
                "POST",
                f"/api/v1/sessions/{session_id}/chat",
                json={"message": question, "locale": "zh-CN"},
            ) as resp:
                assert resp.status_code == 200
                async for _ in resp.aiter_lines():
                    pass

        msgs = (await client.get(f"/api/v1/sessions/{session_id}/messages")).json()[
            "items"
        ]
        assert [m["role"] for m in msgs] == [
            "user",
            "assistant",
            "user",
            "assistant",
        ]
        assert msgs[0]["content"]["text"] == "问题一"
        assert msgs[1]["content"]["text"] == "第一次回答"
        assert msgs[3]["content"]["text"] == "第二次回答"

        listed = (await client.get("/api/v1/sessions")).json()["items"]
        assert listed[0]["id"] == session_id
        await client.post("/api/v1/workspaces/close")
