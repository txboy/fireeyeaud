"""SQL 助手 B2：样本行工具（只按表名取样本，不接受模型生成的 SQL）。"""

from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import AIMessage, AIMessageChunk

from fireeyeaud_agent.agent import sql_assistant as mod
from fireeyeaud_agent.agent.sql_assistant import (
    build_preview_sql,
    compact_sample,
    stream_sql_assistant,
)
from fireeyeaud_agent.api.db import SqlChatBody
from fireeyeaud_agent.errors import ApiError


def _body(**overrides) -> SqlChatBody:
    data = {
        "scope": "project",
        "connectionId": "c1",
        "table": "voucher",
        "driver": "sqlite",
        "messages": [{"role": "user", "content": "统计各科目金额"}],
        "context": {
            "connection": {"id": "c1", "name": "本地", "driver": "sqlite", "database": None},
            "table": {"name": "voucher", "columns": [{"name": "id", "type": "INTEGER"}]},
            "tables": [{"name": "ledger", "columns": [{"name": "id", "type": "INTEGER"}]}],
            "tablesTruncated": False,
            "currentSql": "SELECT * FROM voucher",
            "executedSql": None,
            "result": None,
            "resultTruncated": False,
            "error": None,
            "page": 1,
            "pageSize": 50,
            "total": None,
        },
        "locale": "zh-CN",
    }
    data.update(overrides)
    return SqlChatBody(**data)


class _Scripted:
    """按脚本产出 AI 消息的假模型，支持 tool_calls。"""

    def __init__(self, messages: list[AIMessage]) -> None:
        self._messages = list(messages)
        self.bound = False

    def bind_tools(self, _tools):
        self.bound = True
        return self

    async def astream(self, _messages):
        message = self._messages.pop(0)
        if isinstance(message, str):  # pragma: no cover - 便于写测试
            message = AIMessage(content=message)
        yield AIMessageChunk(
            content=message.content or "",
            tool_calls=list(message.tool_calls or []),
        )


def _tool_call(table: str, call_id: str = "call_1") -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[{"name": "preview_table", "args": {"table": table}, "id": call_id}],
    )


async def _collect(body: SqlChatBody, *, model, preview):
    events = []
    async for envelope in stream_sql_assistant(root=None, body=body, model=model, preview=preview):
        events.append(envelope)
    return events


# ---- 纯函数：SQL 拼接 ----

def test_build_preview_sql_is_always_a_single_select() -> None:
    assert build_preview_sql("sqlite", "voucher") == 'SELECT * FROM "voucher" LIMIT 5'
    assert build_preview_sql("mysql", "voucher") == "SELECT * FROM `voucher` LIMIT 5"
    assert build_preview_sql("mssql", "voucher") == "SELECT * FROM [voucher] LIMIT 5"
    assert build_preview_sql("access", "voucher") == "SELECT * FROM [voucher] LIMIT 5"
    assert build_preview_sql("postgresql", "voucher") == 'SELECT * FROM "voucher" LIMIT 5'


def test_build_preview_sql_quotes_injection_in_table_name() -> None:
    """表名来自模型：引号必须被转义，绝不能拼出第二条语句。"""
    sql = build_preview_sql("sqlite", 'v"; DROP TABLE x; --')
    assert sql == 'SELECT * FROM "v""; DROP TABLE x; --" LIMIT 5'
    assert sql.count(";") == 2  # 都在字符串字面量里，仍是单条 SELECT
    assert sql.startswith("SELECT * FROM")
    assert sql.endswith("LIMIT 5")

    assert build_preview_sql("mssql", "a]]; DROP TABLE x").endswith("LIMIT 5")


def test_build_preview_sql_caps_limit() -> None:
    assert "LIMIT 5" in build_preview_sql("sqlite", "t", limit=999)
    assert "LIMIT 1" in build_preview_sql("sqlite", "t", limit=0)


# ---- 纯函数：样本裁剪 ----

def test_compact_sample_caps_rows_columns_and_cells() -> None:
    raw = {
        "columns": [f"c{i}" for i in range(80)],
        "rows": [["x" * 500 for _ in range(80)] for _ in range(20)],
    }
    payload, truncated = compact_sample(raw)

    assert truncated is True
    assert len(payload["columns"]) == mod.SAMPLE_COLS
    assert len(payload["rows"]) == mod.SAMPLE_ROWS
    assert all(len(row) == mod.SAMPLE_COLS for row in payload["rows"])
    longest = max(len(cell) for row in payload["rows"] for cell in row)
    assert longest <= mod.SAMPLE_CELL_CHARS + 1
    assert payload["rowCount"] == mod.SAMPLE_ROWS


def test_compact_sample_keeps_small_sample_intact() -> None:
    raw = {"columns": ["id"], "rows": [[1], [2]]}
    payload, truncated = compact_sample(raw)
    assert truncated is False
    assert payload == {"columns": ["id"], "rows": [[1], [2]], "rowCount": 2}


# ---- 循环：事件与边界 ----

async def test_tool_call_and_result_events_are_emitted() -> None:
    model = _Scripted(
        [
            _tool_call("ledger"),
            AIMessage(content="```sql\nSELECT * FROM ledger\n```"),
        ]
    )
    seen: list[str] = []

    def preview(table: str) -> dict:
        seen.append(table)
        return {"columns": ["id"], "rows": [[1]], "rowCount": 1}

    events = await _collect(_body(), model=model, preview=preview)
    types = [e["type"] for e in events]

    assert seen == ["ledger"]
    assert types[0] == "status"
    assert "tool_call" in types
    assert "tool_result" in types
    assert types[-1] == "done"
    assert types.index("tool_call") < types.index("tool_result")

    call = next(e for e in events if e["type"] == "tool_call")
    assert call["data"]["tool"] == "preview_table"
    assert call["data"]["params"] == {"table": "ledger"}
    result = next(e for e in events if e["type"] == "tool_result")
    assert result["data"]["ok"] is True
    assert result["data"]["callId"] == call["data"]["callId"]
    assert "ledger" in result["data"]["summary"]

    streamed = "".join(e["data"].get("delta", "") for e in events if e["type"] == "token")
    assert "SELECT * FROM ledger" in streamed
    # seq 连续
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))


async def test_tool_refuses_table_outside_context_without_querying() -> None:
    model = _Scripted([_tool_call("secret_table"), AIMessage(content="好的")])
    called: list[str] = []

    def preview(table: str) -> dict:
        called.append(table)
        return {"columns": [], "rows": [], "rowCount": 0}

    events = await _collect(_body(), model=model, preview=preview)

    assert called == [], "未在上下文中的表不得查询"
    result = next(e for e in events if e["type"] == "tool_result")
    assert result["data"]["ok"] is False
    assert events[-1]["type"] == "done"


async def test_tool_failure_does_not_break_the_stream() -> None:
    model = _Scripted([_tool_call("ledger"), AIMessage(content="改用当前表")])

    def preview(_table: str) -> dict:
        raise ApiError("E_DB_CONN", 502, "error.dbConn")

    events = await _collect(_body(), model=model, preview=preview)

    assert "error" not in [e["type"] for e in events]
    result = next(e for e in events if e["type"] == "tool_result")
    assert result["data"]["ok"] is False
    assert result["data"]["messageKey"] == "error.dbConn"
    assert events[-1]["type"] == "done"


async def test_tool_rounds_are_capped() -> None:
    """模型反复要样本：调用次数被上限截断，最终仍会出 done。"""
    model = _Scripted([_tool_call("ledger", f"call_{i}") for i in range(10)])
    calls: list[str] = []

    def preview(table: str) -> dict:
        calls.append(table)
        return {"columns": ["id"], "rows": [[1]], "rowCount": 1}

    events = await _collect(_body(), model=model, preview=preview)

    assert len(calls) == mod.MAX_TOOL_ROUNDS
    assert events[-1]["type"] == "done"
    assert [e["type"] for e in events].count("tool_call") == mod.MAX_TOOL_ROUNDS


async def test_tool_messages_stay_within_budget() -> None:
    """样本内容进入模型前被裁剪，ToolMessage 不会把请求撑爆。"""
    model = _Scripted([_tool_call("ledger"), AIMessage(content="ok")])
    seen: list[list] = []

    class _Capturing(_Scripted):
        async def astream(self, messages):
            seen.append(list(messages))
            async for chunk in super().astream(messages):
                yield chunk

    def preview(_table: str) -> dict:
        return {
            "columns": [f"c{i}" for i in range(80)],
            "rows": [["x" * 500 for _ in range(80)] for _ in range(20)],
        }

    await _collect(_body(), model=_Capturing([_tool_call("ledger"), AIMessage(content="ok")]), preview=preview)

    # 第二轮发给模型的消息里，工具结果必须已被裁剪
    tool_messages = [m for m in seen[1] if m.type == "tool"]
    assert tool_messages
    payload = json.loads(tool_messages[0].content)  # 必须是合法 JSON
    assert payload["rows"]
    assert 0 < len(payload["rows"]) <= mod.SAMPLE_ROWS
    assert 0 < len(payload["columns"]) <= mod.SAMPLE_COLS
    assert payload["truncated"] is True
    assert len(tool_messages[0].content) <= mod.MAX_TOOL_MESSAGE_CHARS


async def test_prompt_mentions_tool_only_when_bound() -> None:
    """绑定了工具才提工具；否则模型会去调用不存在的工具。"""
    seen: list[str] = []

    class _Capturing(_Scripted):
        async def astream(self, messages):
            seen.append(messages[0].content)
            async for chunk in super().astream(messages):
                yield chunk

    await _collect(
        _body(),
        model=_Capturing([AIMessage(content="ok")]),
        preview=lambda _t: {"columns": [], "rows": []},
    )
    assert "preview_table" in seen[0]

    seen.clear()
    await _collect(_body(), model=_Capturing([AIMessage(content="ok")]), preview=None)
    assert "preview_table" not in seen[0]
    assert "不提供样本行工具" in seen[0]


async def test_no_preview_means_no_tools_bound() -> None:
    """未注入 preview（例如没有连接）时不绑定工具，退回纯生成。"""
    model = _Scripted([AIMessage(content="只给 SQL")])
    events = await _collect(_body(), model=model, preview=None)

    assert model.bound is False
    assert [e["type"] for e in events] == ["status", "token", "done"]