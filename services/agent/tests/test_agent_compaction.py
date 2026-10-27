"""Phase 9 · 上下文压缩接入 run_agent 的行为（T5）。"""


import pytest
from langchain_core.messages import AIMessage, AIMessageChunk, SystemMessage, ToolMessage

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


class _OverflowModel:
    """首次流式调用抛上下文超限，随后成功（always=True 则始终超限）。"""

    def __init__(self, always: bool = False) -> None:
        self.always = always
        self.calls = 0
        self.summary_calls = 0
        self.streams: list[list] = []

    def bind_tools(self, _tools):
        return self

    async def ainvoke(self, _messages):
        self.summary_calls += 1
        return AIMessage(content="摘要Y")

    async def astream(self, messages):
        self.calls += 1
        if self.always or self.calls == 1:
            raise Exception("This model's maximum context length is 8192 tokens")
        self.streams.append(list(messages))
        yield AIMessageChunk(content="完成")


async def test_run_agent_overflow_forces_compaction_and_retries(tmp_path, monkeypatch):
    root, fe, sid, model_id = _setup(
        tmp_path, monkeypatch, n=6, window=131072, max_output=8192
    )
    model = _OverflowModel()
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
    assert model.calls == 2
    assert model.summary_calls == 1
    assert "error" not in types
    assert "compaction" in types
    assert types[-1] == "done"
    joined = _joined(model.streams[0])
    assert "摘要Y" in joined
    assert "m1 " not in joined
    assert "m6 " in joined


async def test_run_agent_overflow_retries_only_once(tmp_path, monkeypatch):
    root, fe, sid, model_id = _setup(
        tmp_path, monkeypatch, n=6, window=131072, max_output=8192
    )
    model = _OverflowModel(always=True)
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
    assert model.calls == 2  # 初次 + 仅一次重试
    errors = [e for e in events if e["type"] == "error"]
    assert errors and errors[0]["data"]["code"] == "E_LLM_UNAVAILABLE"
    assert types[-1] == "done"


class _ReissueUntilToolMsg:
    """直到看到 ToolMessage 才收尾；第二次 astream 抛上下文超限。"""

    def __init__(self) -> None:
        self.calls = 0
        self.summary_calls = 0

    def bind_tools(self, _tools):
        return self

    async def ainvoke(self, _messages):
        self.summary_calls += 1
        return AIMessage(content="摘要")

    async def astream(self, messages):
        self.calls += 1
        if self.calls == 2:
            raise Exception("This model's maximum context length is 8192 tokens")
        if not any(isinstance(m, ToolMessage) for m in messages):
            yield AIMessageChunk(
                content="",
                tool_calls=[
                    {
                        "name": "report_finding",
                        "args": {"title": "重复疑点", "description": "x"},
                        "id": "call_1",
                    }
                ],
            )
        else:
            yield AIMessageChunk(content="完成")


async def test_overflow_retry_preserves_executed_tools(tmp_path, monkeypatch):
    root, fe, sid, model_id = _setup(
        tmp_path, monkeypatch, n=6, window=131072, max_output=8192
    )
    model = _ReissueUntilToolMsg()
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
    assert events[-1]["type"] == "done"
    # 溢出重试必须保留本轮已执行的工具消息，避免重复执行产生重复疑点/证据。
    findings = [e for e in events if e["type"] == "finding"]
    assert len(findings) == 1


class _SummaryFails:
    def __init__(self) -> None:
        self.calls = 0

    def bind_tools(self, _tools):
        return self

    async def ainvoke(self, _messages):
        raise Exception("summarizer down")

    async def astream(self, _messages):
        self.calls += 1
        yield AIMessageChunk(content="完成")


async def test_summary_failure_does_not_abort_turn(tmp_path, monkeypatch):
    root, fe, sid, model_id = _setup(
        tmp_path, monkeypatch, n=20, window=200, max_output=50
    )
    model = _SummaryFails()
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
    # 摘要失败不应中断整轮：仍正常完成，不产生 compaction 事件。
    assert events[-1]["type"] == "done"
    assert model.calls == 1
    assert "compaction" not in [e["type"] for e in events]


async def test_done_usage_has_estimate_and_window(tmp_path, monkeypatch):
    root, fe, sid, model_id = _setup(
        tmp_path, monkeypatch, n=2, window=131072, max_output=8192
    )
    model = _CompactModel()
    events = [
        e
        async for e in run_agent(
            root,
            sid,
            "继续",
            "zh-CN",
            model=model,
            model_id=model_id,
            history_entries=_history_entries(fe, sid),
        )
    ]
    usage = events[-1]["data"]["usage"]
    assert usage["contextWindow"] == 131072
    assert usage["tokensEstimated"] > 0
    listed = sessions.list_sessions(fe)
    assert listed[0]["tokensEstimate"] == usage["tokensEstimated"]


async def test_run_agent_never_compacts_system_or_current_turn(tmp_path, monkeypatch):
    root, fe, sid, model_id = _setup(
        tmp_path, monkeypatch, n=20, window=200, max_output=50
    )
    model = _CompactModel()
    entries = _history_entries(fe, sid)

    events = [
        e
        async for e in run_agent(
            root,
            sid,
            "本轮问题",
            "zh-CN",
            model=model,
            model_id=model_id,
            history_entries=entries,
        )
    ]
    sent = model.streams[0]
    # system prompt 恒在首位，且不被压缩。
    assert isinstance(sent[0], SystemMessage)
    comp = next(e for e in events if e["type"] == "compaction")
    assert comp["data"]["summarizedUpTo"] <= max(int(e["seq"]) for e in entries)
    # 本轮用户消息不在可压缩范围内，始终保留。
    assert "本轮问题" in _joined(sent)


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
