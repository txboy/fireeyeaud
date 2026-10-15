import httpx
from fake_model import FakeChatModel
from langchain_core.messages import AIMessage

from fireeyeaud_agent.agent import graph as graph_mod
from fireeyeaud_agent.main import app
from fireeyeaud_agent.store import sessions as sessions_store
from fireeyeaud_agent.store.project import save_project


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


async def test_session_messages_persisted(tmp_path, monkeypatch) -> None:
    answers = iter([AIMessage(content="第一次回答"), AIMessage(content="第二次回答")])
    monkeypatch.setattr(
        graph_mod,
        "build_chat_model",
        lambda *_a, **_k: FakeChatModel(messages=answers),
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


async def test_session_create_untitled_and_rename(tmp_path) -> None:
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})

        created = await client.post("/api/v1/sessions", json={"title": None})
        session_id = created.json()["id"]
        assert created.json()["title"] is None

        renamed = await client.patch(
            f"/api/v1/sessions/{session_id}", json={"title": "新标题"}
        )
        assert renamed.status_code == 200

        listed = (await client.get("/api/v1/sessions")).json()["items"]
        assert listed[0]["id"] == session_id
        assert listed[0]["title"] == "新标题"
        await client.post("/api/v1/workspaces/close")


def _reset_counters(fe) -> None:
    """模拟 project.json 被重建/计数丢失，而 checkpoints.sqlite 仍在。"""
    save_project(fe, {"schemaVersion": 1, "counters": {}})


def test_message_ids_survive_counter_reset(tmp_path) -> None:
    fe = tmp_path / ".fireeye"
    fe.mkdir()
    session_id = sessions_store.create_session(fe, tmp_path, "会话")["id"]
    sessions_store.add_message(fe, tmp_path, session_id, "user", {"text": "问题一"})
    sessions_store.add_message(fe, tmp_path, session_id, "assistant", {"text": "回答一"})

    _reset_counters(fe)

    # 计数被重置后仍须生成未占用的 id，而不是复用已存在的 m_1。
    message = sessions_store.add_message(
        fe, tmp_path, session_id, "user", {"text": "问题二"}
    )
    assert message["id"] == "m_3"
    assert [m["id"] for m in sessions_store.get_messages(fe, session_id)] == [
        "m_1",
        "m_2",
        "m_3",
    ]


def test_session_ids_survive_counter_reset(tmp_path) -> None:
    fe = tmp_path / ".fireeye"
    fe.mkdir()
    assert sessions_store.create_session(fe, tmp_path, None)["id"] == "s_1"

    _reset_counters(fe)

    assert sessions_store.create_session(fe, tmp_path, None)["id"] == "s_2"
