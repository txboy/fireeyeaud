from pathlib import Path

import pytest
from langchain_core.messages import AIMessage, SystemMessage

import fireeyeaud_agent.agent.compaction as compaction_mod
from fireeyeaud_agent.agent.compaction import (
    CompactionResult,
    fold_transcript,
    is_context_overflow,
    plan_compaction,
    prepare,
    summary_message,
)
from fireeyeaud_agent.agent.token_budget import heuristic_tokens
from fireeyeaud_agent.config.settings import settings
from fireeyeaud_agent.store import sessions


@pytest.fixture(autouse=True)
def _force_heuristic_estimator(monkeypatch):
    """固定估算器为启发式：使边界断言与后端分词器无关（估算器由 T2 单独覆盖）。"""
    monkeypatch.setattr(compaction_mod, "estimate_tokens", heuristic_tokens)


def _ws(tmp_path, monkeypatch) -> Path:
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)
    return root


def _entry(seq: int, tokens: int, role: str = "user") -> dict:
    # 拉丁字符 4 字符/token；10 个 token → 40 字符。
    return {"seq": seq, "role": role, "text": "a" * (tokens * 4), "tokens": tokens}


class _Summarizer:
    def __init__(self, reply: str = "摘要正文") -> None:
        self.reply = reply
        self.calls = 0
        self.transcripts: list[str] = []

    async def ainvoke(self, messages):
        self.calls += 1
        self.transcripts.append("\n".join(str(m.content) for m in messages))
        return AIMessage(content=self.reply)


_APP = {
    "auto": True,
    "keepTokens": 100,
    "reserveOutputTokens": 50,
    "threshold": 0.9,
}


# --- is_context_overflow ---------------------------------------------------


def test_is_context_overflow_detects_common_messages():
    assert is_context_overflow(
        Exception("This model's maximum context length is 8192 tokens")
    )
    assert is_context_overflow(Exception("context_length_exceeded"))
    assert is_context_overflow(Exception("reduce the length of the messages"))


def test_is_context_overflow_ignores_unrelated():
    assert not is_context_overflow(Exception("connection refused"))
    assert not is_context_overflow(Exception("401 unauthorized"))


# --- plan_compaction -------------------------------------------------------


def test_plan_compaction_keeps_recent_and_summarizes_older():
    entries = [_entry(seq, 10) for seq in range(1, 7)]  # 6 × 10 tokens
    # keep ≤ 25 → 保留最近的 2 条（seq 6、5），其余到 seq 4 之前并入摘要
    assert plan_compaction(entries, keep_tokens=25) == 4


def test_plan_compaction_none_when_everything_fits():
    entries = [_entry(seq, 10) for seq in range(1, 4)]
    assert plan_compaction(entries, keep_tokens=10_000) is None


def test_plan_compaction_never_summarizes_newest():
    entries = [_entry(seq, 100) for seq in range(1, 6)]
    boundary = plan_compaction(entries, keep_tokens=1)
    assert boundary is None or boundary < 5


def test_plan_compaction_incremental_after_previous_up_to():
    entries = [_entry(seq, 10) for seq in range(1, 31)]
    assert plan_compaction(entries, keep_tokens=100, previous_up_to=10) == 20


def test_plan_compaction_noop_when_previous_up_to_is_latest():
    entries = [_entry(seq, 10) for seq in range(1, 6)]
    assert plan_compaction(entries, keep_tokens=100, previous_up_to=5) is None


# --- fold_transcript -------------------------------------------------------


def test_fold_transcript_covers_only_new_range():
    entries = [_entry(seq, 10) for seq in range(1, 6)]
    text = fold_transcript(entries, after_up_to=2, up_to=4)
    assert "#2" not in text
    assert "#3" in text and "#4" in text
    assert "#5" not in text


# --- summary_message -------------------------------------------------------


def test_summary_message_marks_compaction():
    message = summary_message({"text": "早期摘要", "upTo": 12})
    assert isinstance(message, SystemMessage)
    assert "早期摘要" in message.content
    assert "12" in message.content


# --- prepare ---------------------------------------------------------------


async def test_prepare_not_triggered_when_under_threshold(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    fe = root / ".fireeye"
    sid = sessions.create_session(fe, root, None)["id"]
    model = _Summarizer()

    result = await prepare(
        fe,
        sid,
        entries=[_entry(1, 1)],
        system_text="a" * 4,
        new_turn_text="a" * 4,
        model=model,
        model_id="mdl_1",
        profile={"contextWindow": 200, "maxOutputTokens": 50},
        app_compaction=_APP,
    )
    assert isinstance(result, CompactionResult)
    assert result.compacted is False
    assert model.calls == 0
    assert sessions.get_summary(fe, sid) is None


async def test_prepare_triggers_and_persists(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    fe = root / ".fireeye"
    sid = sessions.create_session(fe, root, None)["id"]
    model = _Summarizer()

    result = await prepare(
        fe,
        sid,
        entries=[_entry(seq, 10) for seq in range(1, 21)],
        system_text="a" * 40,
        new_turn_text="a" * 40,
        model=model,
        model_id="mdl_1",
        profile={"contextWindow": 200, "maxOutputTokens": 50},
        app_compaction=_APP,
    )
    assert result.compacted is True
    assert result.summarized_up_to == 10
    assert result.tokens_after < result.tokens_before
    assert model.calls == 1

    stored = sessions.get_summary(fe, sid)
    assert stored["text"] == "摘要正文"
    assert stored["upTo"] == 10
    assert stored["modelId"] == "mdl_1"
    assert stored["window"] == 200


async def test_prepare_idempotent_same_boundary(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    fe = root / ".fireeye"
    sid = sessions.create_session(fe, root, None)["id"]
    model = _Summarizer()
    entries = [_entry(seq, 10) for seq in range(1, 21)]

    common = dict(
        system_text="a" * 40,
        new_turn_text="a" * 40,
        model=model,
        model_id="mdl_1",
        profile={"contextWindow": 200, "maxOutputTokens": 50},
        app_compaction=_APP,
    )
    first = await prepare(fe, sid, entries=entries, **common)
    second = await prepare(fe, sid, entries=entries, **common)
    assert first.compacted is True
    assert second.compacted is False
    assert model.calls == 1


async def test_prepare_incremental_only_new_range(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    fe = root / ".fireeye"
    sid = sessions.create_session(fe, root, None)["id"]
    model = _Summarizer()
    common = dict(
        system_text="a" * 40,
        new_turn_text="a" * 40,
        model=model,
        model_id="mdl_1",
        profile={"contextWindow": 200, "maxOutputTokens": 50},
        app_compaction=_APP,
    )
    await prepare(fe, sid, entries=[_entry(seq, 10) for seq in range(1, 21)], **common)
    result = await prepare(
        fe, sid, entries=[_entry(seq, 10) for seq in range(1, 41)], **common
    )
    assert result.compacted is True
    assert result.summarized_up_to == 30
    assert model.calls == 2
    # 第二次只并入 seq 11..30，不含已并入的 seq ≤ 10。
    second = model.transcripts[1]
    assert "#11" in second and "#30" in second
    assert "#10]" not in second


async def test_model_switch_up_does_not_rollback(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    fe = root / ".fireeye"
    sid = sessions.create_session(fe, root, None)["id"]
    model = _Summarizer()
    entries = [_entry(seq, 10) for seq in range(1, 21)]

    await prepare(
        fe,
        sid,
        entries=entries,
        system_text="a" * 40,
        new_turn_text="a" * 40,
        model=model,
        model_id="mdl_small",
        profile={"contextWindow": 200, "maxOutputTokens": 50},
        app_compaction=_APP,
    )
    before = sessions.get_summary(fe, sid)

    # 切到大窗口：不再触发，摘要保持不变。
    result = await prepare(
        fe,
        sid,
        entries=entries,
        system_text="a" * 40,
        new_turn_text="a" * 40,
        model=model,
        model_id="mdl_big",
        profile={"contextWindow": 131072, "maxOutputTokens": 8192},
        app_compaction=_APP,
    )
    assert result.compacted is False
    assert sessions.get_summary(fe, sid) == before
    assert model.calls == 1


async def test_model_switch_down_compacts_immediately(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    fe = root / ".fireeye"
    sid = sessions.create_session(fe, root, None)["id"]
    model = _Summarizer()
    entries = [_entry(seq, 10) for seq in range(1, 21)]
    common = dict(
        entries=entries,
        system_text="a" * 40,
        new_turn_text="a" * 40,
        model=model,
        app_compaction=_APP,
    )
    big = await prepare(
        fe, sid, model_id="mdl_big",
        profile={"contextWindow": 131072, "maxOutputTokens": 8192}, **common,
    )
    assert big.compacted is False

    small = await prepare(
        fe, sid, model_id="mdl_small",
        profile={"contextWindow": 200, "maxOutputTokens": 50}, **common,
    )
    assert small.compacted is True
    assert small.summarized_up_to == 10


async def test_window_unknown_uses_default(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    fe = root / ".fireeye"
    sid = sessions.create_session(fe, root, None)["id"]
    result = await prepare(
        fe,
        sid,
        entries=[_entry(1, 1)],
        system_text="",
        new_turn_text="",
        model=_Summarizer(),
        model_id=None,
        profile=None,
        app_compaction=_APP,
    )
    assert result.window == settings.default_context_window
