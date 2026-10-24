"""写作代理的共用流式循环：模型 → 工具 → SSE 事件。

报告（``report_agent``）与取证单（``form_agent``）共用；差异全部由调用方以参数传入。
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator, Callable

from langchain_core.messages import AIMessage, ToolMessage

from ..errors import ApiError

MAX_STEPS = 12


def dump(data: Any) -> str:
    import json

    return json.dumps(data, ensure_ascii=False)


async def run_tool_loop(
    model: Any,
    messages: list[Any],
    tool_map: dict[str, Any],
    *,
    mutated_names: set[str],
    on_assistant_text: Callable[[str], None],
    revision: Callable[[], str],
    max_steps: int = MAX_STEPS,
) -> AsyncIterator[dict[str, Any]]:
    """跑一轮对话：流式 delta、工具调用、正文变更事件。"""
    bound = model.bind_tools(list(tool_map.values())) if hasattr(model, "bind_tools") else model
    messages = list(messages)

    for _step in range(max_steps):
        merged: Any = None
        async for chunk in bound.astream(messages):
            if merged is None:
                merged = chunk
            else:
                merged = merged + chunk
            piece = chunk.content
            if isinstance(piece, str) and piece:
                yield {"event": "delta", "data": {"text": piece}}

        if merged is None:
            break

        content = merged.content if isinstance(merged.content, str) else ""
        tool_calls = list(getattr(merged, "tool_calls", []) or [])
        messages.append(AIMessage(content=content, tool_calls=tool_calls))

        if not tool_calls:
            if content.strip():
                on_assistant_text(content)
            break

        if content.strip():
            on_assistant_text(content)

        mutated = False
        for call in tool_calls:
            name = str(call.get("name") or "")
            args = call.get("args") or {}
            tool = tool_map.get(name)
            if tool is None:
                result: Any = {"ok": False, "error": f"unknown tool {name}"}
            else:
                try:
                    result = await asyncio.to_thread(tool.invoke, args)
                except ApiError as exc:
                    result = {
                        "ok": False,
                        "code": exc.code,
                        "messageKey": exc.message_key,
                    }
                except Exception as exc:  # noqa: BLE001 - 工具失败回给模型修正
                    result = {"ok": False, "error": str(exc)[:500]}
            if not isinstance(result, str):
                result = dump(result)
            messages.append(
                ToolMessage(
                    content=result,
                    tool_call_id=str(call.get("id") or name),
                )
            )
            yield {
                "event": "tool",
                "data": {"name": name, "ok": '"ok": false' not in result},
            }
            if name in mutated_names:
                mutated = True

        if mutated:
            yield {"event": "report", "data": {"revision": revision()}}

    yield {"event": "report", "data": {"revision": revision()}}
    yield {"event": "done", "data": {}}