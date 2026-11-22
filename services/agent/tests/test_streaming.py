import asyncio

import pytest
from langchain_core.messages import AIMessageChunk

from fireeyeaud_agent.agent.streaming import StreamCollector, iter_model
from fireeyeaud_agent.config.settings import settings


class _Model:
    def __init__(self, script):
        self.script = list(script)
        self.calls = 0

    async def astream(self, _messages):
        step = self.script[self.calls]
        self.calls += 1
        if isinstance(step, Exception):
            raise step
        for piece in step:
            yield AIMessageChunk(
                content=piece,
                usage_metadata={
                    "input_tokens": 10,
                    "output_tokens": 1,
                    "total_tokens": 11,
                    "input_token_details": {"cache_read": 4},
                },
            )


@pytest.mark.asyncio
async def test_collects_text_ai_and_usage():
    collector = StreamCollector()
    model = _Model([["你", "好"]])
    pieces = [
        piece
        async for piece in iter_model(
            model, [], timeout_seconds=1, collector=collector
        )
    ]
    assert pieces == ["你", "好"]
    assert collector.ai.content == "你好"
    assert collector.usage["promptTokens"] == 10
    assert collector.usage["cachedTokens"] == 4


@pytest.mark.asyncio
async def test_timeout_raises():
    class _Hang:
        async def astream(self, _messages):
            await asyncio.sleep(5)
            yield AIMessageChunk(content="x")

    collector = StreamCollector()
    with pytest.raises(TimeoutError):
        async for _ in iter_model(
            _Hang(), [], timeout_seconds=0.05, collector=collector
        ):
            pass


@pytest.mark.asyncio
async def test_transient_error_is_retried(monkeypatch):
    monkeypatch.setattr(settings, "llm_retry_base_seconds", 0)
    monkeypatch.setattr(settings, "llm_max_attempts", 3)
    collector = StreamCollector()
    model = _Model([ConnectionError("connection reset"), ["好"]])
    pieces = [
        piece
        async for piece in iter_model(
            model, [], timeout_seconds=1, collector=collector
        )
    ]
    assert pieces == ["好"]
    assert model.calls == 2


@pytest.mark.asyncio
async def test_partial_output_is_not_retried(monkeypatch):
    monkeypatch.setattr(settings, "llm_retry_base_seconds", 0)
    monkeypatch.setattr(settings, "llm_max_attempts", 3)

    class _Partial:
        calls = 0

        async def astream(self, _messages):
            _Partial.calls += 1
            yield AIMessageChunk(content="部分")
            raise ConnectionError("connection reset")

    collector = StreamCollector()
    with pytest.raises(ConnectionError):
        async for _ in iter_model(
            _Partial(), [], timeout_seconds=1, collector=collector
        ):
            pass
    assert _Partial.calls == 1
