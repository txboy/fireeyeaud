import asyncio

import pytest

from fireeyeaud_agent.agent import graph
from fireeyeaud_agent.agent.graph import _run_tool
from fireeyeaud_agent.errors import ApiError


async def test_async_tool_timeout_raises_api_error(tmp_path, monkeypatch):
    monkeypatch.setattr(graph.settings, "tool_timeout_seconds", 0.05)

    async def slow(_root, _args):
        await asyncio.sleep(1)
        return {"ok": True}

    with pytest.raises(ApiError) as exc:
        await _run_tool({"slow": slow}, "slow", {}, tmp_path)
    assert exc.value.code == "E_TOOL_TIMEOUT"


async def test_sync_tool_runs_off_event_loop(tmp_path):
    import threading

    def blocking(_root, _args):
        return {"thread": threading.current_thread().name}

    out = await _run_tool({"blocking": blocking}, "blocking", {}, tmp_path)
    assert out["thread"] != threading.main_thread().name
