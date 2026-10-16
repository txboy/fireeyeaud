import json

import httpx
from langchain_core.messages import AIMessage, AIMessageChunk

from fake_model import FakeChatModel

from fireeyeaud_agent.agent import graph as graph_mod
from fireeyeaud_agent.main import app


def _parse_sse(text: str) -> list[dict]:
    events = []
    for line in text.splitlines():
        if line.startswith("data:"):
            events.append(json.loads(line[5:].strip()))
    return events


async def test_chat_streams_sse_envelope(tmp_path, monkeypatch) -> None:
    fake = FakeChatModel(messages=iter([AIMessage(content="你好，这是回答")]))
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

        msgs = (await client.get(f"/api/v1/sessions/{session_id}/messages")).json()[
            "items"
        ]
        await client.post("/api/v1/workspaces/close")

    user_msg = next(m for m in msgs if m["role"] == "user")
    assert user_msg["content"]["text"] == "你好"
    assert user_msg["content"]["options"]["rules"] == []

    events = _parse_sse(text)
    types = [e["type"] for e in events]

    assert types[0] == "status"
    assert "context" in types
    assert "token" in types
    assert types[-2] == "done"
    assert types[-1] == "persisted"
    persisted = events[-1]
    assert persisted["data"]["userMessageId"].startswith("m_")
    assert persisted["data"]["assistantMessageId"].startswith("m_")
    assert all(e["sessionId"] == session_id for e in events)
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))

    ctx = next(e for e in events if e["type"] == "context")
    assert ctx["data"]["options"]["rules"] == []
    assert ctx["data"]["options"]["model"] is None

    streamed = "".join(e["data"]["delta"] for e in events if e["type"] == "token")
    assert "你好" in streamed
    assert "这是回答" in streamed


async def test_chat_persists_context_and_attachments(tmp_path, monkeypatch) -> None:
    """回归：chat 请求的 context 必须扁平传入并被快照/门控使用；附件随消息留存。"""
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)

    from fireeyeaud_agent.config import store as config_store

    conn = config_store.create_item(
        "db",
        {"name": "库一", "driver": "sqlite", "scope": "project"},
        root,
    )
    kb = config_store.create_item(
        "knowledge",
        {"type": "dify", "name": "合同库", "baseUrl": "http://x", "scope": "project"},
        root,
    )

    fake = FakeChatModel(messages=iter([AIMessage(content="好的")]))
    monkeypatch.setattr(graph_mod, "build_chat_model", lambda *_a, **_k: fake)

    attachment = {"path": "D:/tmp/a.pdf", "name": "a.pdf"}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        sid = (await client.post("/api/v1/sessions", json={"title": "t"})).json()["id"]

        async with client.stream(
            "POST",
            f"/api/v1/sessions/{sid}/chat",
            json={
                "message": "看下合同",
                "locale": "zh-CN",
                "dbConnectionIds": [conn["id"]],
                "kbProviderIds": [kb["id"]],
                "attachments": [attachment],
            },
        ) as resp:
            assert resp.status_code == 200
            _ = "".join([chunk async for chunk in resp.aiter_text()])

        msgs = (await client.get(f"/api/v1/sessions/{sid}/messages")).json()["items"]
        await client.post("/api/v1/workspaces/close")

    user = next(m for m in msgs if m["role"] == "user")
    assert user["content"]["options"]["database"] == [
        {"id": conn["id"], "name": "库一"}
    ]
    assert user["content"]["options"]["knowledge"] == [
        {"id": kb["id"], "name": "合同库"}
    ]
    assert user["content"]["attachments"] == [attachment]


class _CapturingModel:
    """记录本轮发给模型的 messages，用于断言多模态内容块。"""

    def __init__(self) -> None:
        self.received: list = []

    def bind_tools(self, _tools):
        return self

    async def astream(self, messages):
        self.received = list(messages)
        yield AIMessageChunk(content="看到了")


async def test_chat_vision_model_sends_image_block(tmp_path, monkeypatch) -> None:
    """vision=true 的模型：图片附件应作为 image_url 内容块随用户消息发出。"""
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)

    from PIL import Image

    from fireeyeaud_agent.config import store as config_store

    config_store.create_item(
        "models",
        {
            "name": "多模态",
            "baseUrl": "http://x/v1",
            "model": "m",
            "vision": True,
            "isDefault": True,
            "scope": "project",
        },
        root,
    )
    image = root / "pic.png"
    Image.new("RGB", (200, 120), "white").save(image)

    model = _CapturingModel()
    monkeypatch.setattr(graph_mod, "build_chat_model", lambda *_a, **_k: model)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        sid = (await client.post("/api/v1/sessions", json={"title": "t"})).json()["id"]
        async with client.stream(
            "POST",
            f"/api/v1/sessions/{sid}/chat",
            json={
                "message": "看下这张图",
                "locale": "zh-CN",
                "attachments": [{"path": str(image), "name": "pic.png"}],
            },
        ) as resp:
            assert resp.status_code == 200
            _ = "".join([chunk async for chunk in resp.aiter_text()])
        await client.post("/api/v1/workspaces/close")

    human = model.received[-1]
    assert isinstance(human.content, list)
    assert human.content[0] == {"type": "text", "text": "看下这张图"}
    assert human.content[1]["type"] == "image_url"
    assert human.content[1]["image_url"]["url"].startswith("data:image/")


async def test_chat_text_model_keeps_text_extraction(tmp_path, monkeypatch) -> None:
    """vision=false：图片附件仍标 unsupported（不产生图像块）。"""
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)

    from PIL import Image

    from fireeyeaud_agent.config import store as config_store

    config_store.create_item(
        "models",
        {"name": "纯文本", "baseUrl": "http://x/v1", "model": "m", "isDefault": True},
        root,
    )
    image = root / "pic.png"
    Image.new("RGB", (200, 120), "white").save(image)

    model = _CapturingModel()
    monkeypatch.setattr(graph_mod, "build_chat_model", lambda *_a, **_k: model)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        sid = (await client.post("/api/v1/sessions", json={"title": "t"})).json()["id"]
        async with client.stream(
            "POST",
            f"/api/v1/sessions/{sid}/chat",
            json={
                "message": "看下这张图",
                "locale": "zh-CN",
                "attachments": [{"path": str(image), "name": "pic.png"}],
            },
        ) as resp:
            assert resp.status_code == 200
            text = "".join([chunk async for chunk in resp.aiter_text()])
        await client.post("/api/v1/workspaces/close")

    human = model.received[-1]
    assert human.content == "看下这张图"
    # 不支持图片 → 发 notice 提示，且不产生图像块。
    events = _parse_sse(text)
    notices = [e for e in events if e["type"] == "notice"]
    assert notices and notices[0]["data"]["messageKey"] == "attachmentUnsupported"
    assert "pic.png" in notices[0]["data"]["params"]["files"]


async def test_attachment_text_persists_into_history(tmp_path, monkeypatch) -> None:
    """回归：附件文本落库后，第二轮追问时历史回放应带上它（解决多轮看不见文件）。"""
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)

    from PIL import Image

    from fireeyeaud_agent.config import store as config_store

    config_store.create_item(
        "models",
        {
            "name": "多模态",
            "baseUrl": "http://x/v1",
            "model": "m",
            "vision": True,
            "isDefault": True,
            "scope": "project",
        },
        root,
    )
    image = root / "pic.png"
    Image.new("RGB", (200, 120), "white").save(image)

    model = _CapturingModel()
    monkeypatch.setattr(graph_mod, "build_chat_model", lambda *_a, **_k: model)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        sid = (await client.post("/api/v1/sessions", json={"title": "t"})).json()["id"]
        for payload in (
            {
                "message": "看下这张图",
                "locale": "zh-CN",
                "attachments": [{"path": str(image), "name": "pic.png"}],
            },
            {"message": "再问一句", "locale": "zh-CN"},
        ):
            async with client.stream(
                "POST", f"/api/v1/sessions/{sid}/chat", json=payload
            ) as resp:
                assert resp.status_code == 200
                _ = "".join([chunk async for chunk in resp.aiter_text()])
        msgs = (await client.get(f"/api/v1/sessions/{sid}/messages")).json()["items"]
        await client.post("/api/v1/workspaces/close")

    user1 = next(m for m in msgs if m["role"] == "user")
    assert user1["content"]["attachmentTexts"][0]["name"] == "pic.png"
    assert user1["content"]["attachmentTexts"][0]["source"] == "vision"

    # 第二轮发给模型的消息里，历史用户的附件文本应已并入正文。
    joined = "\n".join(
        m.content for m in model.received if isinstance(m.content, str)
    )
    assert "附件资料" in joined
    assert "pic.png" in joined
