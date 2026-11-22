import pytest
from langchain_core.messages import AIMessageChunk

from fireeyeaud_agent.agent.graph import run_agent
from fireeyeaud_agent.agent.retry import is_retryable, retry_delay
from fireeyeaud_agent.config.settings import settings
from fireeyeaud_agent.store.duckdb import Database


def _seed(tmp_path):
    fe = tmp_path / ".fireeye"
    (fe / "index").mkdir(parents=True)
    db = Database(fe / "workspace.duckdb")
    db.create_table_from_rows("src_ds1_x", ["a"], [["1"]])
    db.close()


def test_is_retryable_classification():
    assert is_retryable(ConnectionError("connection reset by peer")) is True
    assert is_retryable(RuntimeError("429 rate limit exceeded")) is True
    assert is_retryable(TimeoutError()) is False
    assert is_retryable(ValueError("bad request")) is False


def test_retry_delay_is_bounded():
    assert 0 <= retry_delay(1, base=0.1, cap=1.0) <= 0.1
    assert 0 <= retry_delay(10, base=0.1, cap=0.5) <= 0.5


class _FlakyModel:
    def __init__(self):
        self.calls = 0

    def bind_tools(self, _tools):
        return self

    async def astream(self, _messages):
        self.calls += 1
        if self.calls == 1:
            raise ConnectionError("connection reset by peer")
        yield AIMessageChunk(content="恢复成功")


@pytest.mark.asyncio
async def test_transient_error_is_retried(tmp_path, monkeypatch):
    _seed(tmp_path)
    monkeypatch.setattr(settings, "llm_retry_base_seconds", 0)
    monkeypatch.setattr(settings, "llm_max_attempts", 3)
    model = _FlakyModel()
    events = [
        e async for e in run_agent(tmp_path, "s_1", "你好", "zh-CN", model=model)
    ]
    assert model.calls == 2
    assert events[-1]["type"] == "done"
    assert any(
        e["type"] == "token" and e["data"]["delta"] == "恢复成功" for e in events
    )


class _PartialThenFailModel:
    def __init__(self):
        self.calls = 0

    def bind_tools(self, _tools):
        return self

    async def astream(self, _messages):
        self.calls += 1
        yield AIMessageChunk(content="部分")
        raise ConnectionError("connection reset by peer")


@pytest.mark.asyncio
async def test_partial_output_is_not_retried(tmp_path, monkeypatch):
    _seed(tmp_path)
    monkeypatch.setattr(settings, "llm_retry_base_seconds", 0)
    monkeypatch.setattr(settings, "llm_max_attempts", 3)
    model = _PartialThenFailModel()
    events = [
        e async for e in run_agent(tmp_path, "s_1", "你好", "zh-CN", model=model)
    ]
    assert model.calls == 1
    assert any(e["type"] == "error" for e in events)
