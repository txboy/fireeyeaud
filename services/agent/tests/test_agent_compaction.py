"""Phase 9 · 上下文压缩接入 run_agent 的行为（T5）。"""

from pathlib import Path

import pytest
from langchain_core.messages import AIMessage, AIMessageChunk

import fireeyeaud_agent.agent.compaction as compaction_mod
from fireeyeaud_agent.agent.graph import _history_entries, run_agent
from fireeyeaud_agent.agent.token_budget import heuristic_tokens
from fireeyeaud_agent.config import store as cfg_store
from fireeyeaud_agent.store import app_settings
from fireeyeaud_agent.store import sessions


@pytest.fixture(autouse=True)
def _force_heuristic_estimator(monkeypatch):
    monkeypatch.setattr(compaction_mod, "estimate_tokens", heuristic_tokens)


class _CompactModel:
    """既用于压缩摘要（ainvoke），也用于本轮流式（astream）。"""

    def __init__(self, summary: str = "摘要X") -> None:
        self.summary = summary
        self.summary_calls = 0
        self.streams: list[list] = []

    def bind_tools(self, _tools):
        return self

    async def ainvoke(self, _messages):
        self.summary_calls += 1
        return AIMessage(content=self.summary)

    async def astream(self, messages):
        self.streams.append(list(messages))
        yield AIMessageChunk(content="完成")


def _setup(tmp_path, monkeypatch, *, n: int, window: int, max_output: int):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    fe = root / ".fireeye"
    fe.mkdir(parents=True)
    sid = sessions.create_session(fe, root, None)["id"]
    for seq in range(1, n + 1):
        role = "user" if seq % 2 == 1 else "assistant"
        sessions.add_message(fe, root, sid, role, {"text": f"m{seq} " + "a" * 40})
    profile = cfg_store.create_item(
        "models",
        {
            "name": "小窗口",
            "baseUrl": "http://x/v1",
            "model": "m",
            "contextWindow": window,
            "maxOutputTokens": max_output,
            "isDefault": True,
            "scope": "project",
        },
        root,
    )
    app_settings.patch(
        {
            "compaction": {
                "auto": True,
                "keepTokens": 100,
                "reserveOutputTokens": 50,
                "threshold": 0.9,
            }
        }
    )
    return root, fe, sid, profile["id"]


def _joined(messages: list) -> str:
    return "\n".join(m.content for m in messages if isinstance(m.content, str))


async def test_run_agent_compacts_injects_and_filters(tmp_path, monkeypatch):
    root, fe, sid, model_id = _setup(tmp_path, monkeypatch, n=20, window=200, max_output=50)
    model = _CompactModel()
    entries = _history_entries(fe, sid)

    events = [
        e
        async for e in run_agent(
            root,
            sid,
            "继续",
            "zh-CN",
            model=model,
            model_id=model_id,
            history_entries=entries,
        )
    ]
    types = [e["type"] for e in events]
    assert "compaction" in types
    comp = next(e for e in events if e["type"] == "compaction")
    assert comp["data"]["phase"] == "done"
    assert 0 < comp["data"]["summarizedUpTo"] < 20
    assert comp["data"]["tokensBefore"] > comp["data"]["tokensAfter"]
    assert model.summary_calls == 1

    sent = model.streams[0]
    joined = _joined(sent)
    assert "上下文压缩摘要" in joined and "摘要X" in joined
    assert "m1 " not in joined
    assert "m20 " in joined

    idx_summary = next(
        i for i, m in enumerate(sent) if "上下文压缩摘要" in str(m.content)
    )
    idx_recent = next(
        i for i, m in enumerate(sent) if isinstance(m.content, str) and "m20 " in m.content
    )
    assert idx_summary < idx_recent


async def test_run_agent_no_compaction_under_threshold(tmp_path, monkeypatch):
    root, fe, sid, model_id = _setup(
        tmp_path, monkeypatch, n=4, window=131072, max_output=8192
    )
    model = _CompactModel()
    entries = _history_entries(fe, sid)

    events = [
        e
        async for e in run_agent(
            root,
            sid,
            "继续",
            "zh-CN",
            model=model,
            model_id=model_id,
            history_entries=entries,
        )
    ]
    assert "compaction" not in [e["type"] for e in events]
    assert model.summary_calls == 0
    joined = _joined(model.streams[0])
    assert "上下文压缩摘要" not in joined
    assert "m1 " in joined


async def test_run_agent_injects_existing_summary_without_recompaction(
    tmp_path, monkeypatch
):
    root, fe, sid, model_id = _setup(
        tmp_path, monkeypatch, n=10, window=131072, max_output=8192
    )
    sessions.set_summary(
        fe,
        sid,
        {"text": "既有摘要", "upTo": 5, "createdAt": "2026-01-01T00:00:00Z"},
        model_id="mdl_old",
        window=8192,
    )
    model = _CompactModel()
    entries = _history_entries(fe, sid)

    events = [
        e
        async for e in run_agent(
            root,
            sid,
            "继续",
            "zh-CN",
            model=model,
            model_id=model_id,
            history_entries=entries,
        )
    ]
    assert "compaction" not in [e["type"] for e in events]
    assert model.summary_calls == 0
    joined = _joined(model.streams[0])
    assert "上下文压缩摘要" in joined and "既有摘要" in joined
    assert "m1 " not in joined  # seq <= upTo 被过滤
    assert "m10 " in joined
