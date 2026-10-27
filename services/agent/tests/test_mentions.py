import httpx
from langchain_core.messages import AIMessageChunk

from fireeyeaud_agent.agent.graph import _compose_user_message, _normalize_mentions
from fireeyeaud_agent.config import models as models_mod
from fireeyeaud_agent.main import app


def test_normalize_mentions_defaults_and_sanitizes():
    out = _normalize_mentions(
        [
            {"path": "数据\\序时账.xlsx"},
            {"path": "数据/2024", "name": "2024", "isDir": True},
            {"path": ""},
            "bad",
            None,
        ]
    )
    assert out == [
        {"path": "数据/序时账.xlsx", "name": "序时账.xlsx", "isDir": False},
        {"path": "数据/2024", "name": "2024", "isDir": True},
    ]


def test_compose_user_message_without_mentions_is_unchanged():
    assert _compose_user_message("你好", []) == "你好"


def test_compose_user_message_lists_mentions():
    text = _compose_user_message(
        "看下",
        [
            {"path": "数据/序时账.xlsx", "name": "序时账.xlsx", "isDir": False},
            {"path": "数据/2024", "name": "2024", "isDir": True},
        ],
    )
    assert text.startswith("看下")
    assert "@数据/序时账.xlsx" in text
    assert "@数据/2024" in text
    assert "目录" in text


def test_compose_user_message_mentions_only():
    text = _compose_user_message(
        "", [{"path": "a.txt", "name": "a.txt", "isDir": False}]
    )
    assert "@a.txt" in text


class _CapturingModel:
    def __init__(self) -> None:
        self.received: list = []

    def bind_tools(self, _tools):
        return self

    async def astream(self, messages):
        self.received = list(messages)
        yield AIMessageChunk(content="好的")


async def test_chat_with_mentions_persists_and_informs_model(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)
    model = _CapturingModel()
    monkeypatch.setattr(models_mod, "build_chat_model", lambda *_a, **_k: model)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        sid = (await client.post("/api/v1/sessions", json={"title": "t"})).json()["id"]
        async with client.stream(
            "POST",
            f"/api/v1/sessions/{sid}/chat",
            json={
                "message": "看下这个文件",
                "locale": "zh-CN",
                "mentions": [
                    {"path": "数据/序时账.xlsx", "name": "序时账.xlsx", "isDir": False}
                ],
            },
        ) as resp:
            assert resp.status_code == 200
            _ = "".join([chunk async for chunk in resp.aiter_text()])
        msgs = (await client.get(f"/api/v1/sessions/{sid}/messages")).json()["items"]
        await client.post("/api/v1/workspaces/close")

    human = model.received[-1]
    assert "@数据/序时账.xlsx" in human.content

    user = next(m for m in msgs if m["role"] == "user")
    # 持久化保留原文，mention 注记只在喂给模型时合成。
    assert user["content"]["text"] == "看下这个文件"
    assert user["content"]["mentions"] == [
        {"path": "数据/序时账.xlsx", "name": "序时账.xlsx", "isDir": False}
    ]
