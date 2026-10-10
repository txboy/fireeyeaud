"""Agent 循环：plan → tool_call → reflect（Phase 1）。

设计 §7 / §14.7。真实模型经 OpenAI-compatible 接口；工具为进程内 LangChain 工具。
Phase 1 采用 ainvoke + 文本切块产出 `token` 事件（真实流式 token 作为后续增强）。
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from ..config.models import build_chat_model
from ..config.settings import settings
from ..store.evidence import append_evidence
from ..store.findings import create_finding
from ..tools.registry import build_langchain_tools, build_tool_dict
from ..util import now_iso
from .prompts import system_prompt


class ReportFindingArgs(BaseModel):
    title: str = Field(description="疑点标题")
    description: str = Field(description="疑点描述与依据")
    severity: str = Field(default="medium", description="high | medium | low")
    subjects: list[str] = Field(default_factory=list, description="涉及科目")
    amount: str | None = Field(default=None, description="涉及金额（字符串十进制）")
    ruleKey: str | None = Field(default=None, description="规则引用 id（规则型疑点）")
    dataRefs: list[dict[str, Any]] = Field(
        default_factory=list, description="[{sourceId, table, rowRef}]"
    )


def _report_finding_tool() -> StructuredTool:
    def _placeholder(**_kwargs: Any) -> dict[str, Any]:
        return {}

    return StructuredTool.from_function(
        func=_placeholder,
        name="report_finding",
        description="记录一条审计疑点（标题/描述/严重度/科目/金额/数据定位）。",
        args_schema=ReportFindingArgs,
    )


def _event_factory(session_id: str):
    seq = 0

    def event(etype: str, data: dict[str, Any]) -> dict[str, Any]:
        nonlocal seq
        seq += 1
        return {
            "type": etype,
            "seq": seq,
            "sessionId": session_id,
            "ts": now_iso(),
            "data": data,
        }

    return event


def _maybe_bind(model: Any, tools: list[StructuredTool]) -> Any:
    try:
        return model.bind_tools(tools)
    except NotImplementedError:
        return model
    except Exception:  # noqa: BLE001 - 绑定失败则退回未绑定模型
        return model


def _tokenize(text: str) -> list[str]:
    return re.findall(r"\s+|[^\s]{1,3}", text)


def _summarize(result: Any) -> str:
    if isinstance(result, dict):
        if "tables" in result:
            return f"{len(result['tables'])} 张表"
        if "subjects" in result:
            return f"{len(result['subjects'])} 个科目"
        if "vouchers" in result:
            return f"{len(result['vouchers'])} 条凭证"
        if "rows" in result:
            return f"{result.get('rowCount', len(result['rows']))} 行"
        if "chunks" in result:
            return f"{len(result['chunks'])} 段"
        if "balanced" in result:
            return (
                "平衡"
                if result["balanced"]
                else f"{len(result.get('diffs', []))} 处差异"
            )
        if "id" in result:
            return str(result["id"])
    return json.dumps(result, ensure_ascii=False, default=str)[:200]


def _tool_message_content(result: Any) -> str:
    return json.dumps(result, ensure_ascii=False, default=str)


async def run_agent(
    root: Path,
    session_id: str,
    message: str,
    locale: str | None = None,
    *,
    model: Any = None,
    history: list[BaseMessage] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    root = Path(root)
    event = _event_factory(session_id)
    active_model = model or build_chat_model()
    tools = [*build_langchain_tools(root), _report_finding_tool()]
    bound = _maybe_bind(active_model, tools)
    tool_dict = build_tool_dict()

    from ..store.rules import list_rules

    prompt_rules = [
        r
        for r in list_rules(root)
        if r.get("enabled") and r.get("type") == "prompt" and r.get("definition")
    ]
    messages: list[BaseMessage] = [
        SystemMessage(content=system_prompt(locale, prompt_rules))
    ]
    if history:
        messages.extend(history)
    messages.append(HumanMessage(content=message))

    evidence_ids: list[str] = []

    def execute_tool(name: str, args: dict[str, Any]) -> Any:
        if name == "report_finding":
            record = create_finding(
                root,
                title=args.get("title", ""),
                description=args.get("description", ""),
                severity=args.get("severity", "medium"),
                dataRefs=args.get("dataRefs", []),
                sessionId=session_id,
                lang=locale or "zh-CN",
                subjects=args.get("subjects"),
                amount=args.get("amount"),
                ruleKey=args.get("ruleKey"),
                origin="agent",
                evidenceRefs=list(evidence_ids),
            )
            return {"id": record["id"], "status": record["status"]}
        if name not in tool_dict:
            raise ValueError(f"unknown tool: {name}")
        return tool_dict[name](root, args)

    yield event("status", {"phase": "planning"})

    step = 0
    while True:
        step += 1
        if step > settings.max_steps:
            yield event("done", {"usage": {}, "messageKey": "error.agentLimit"})
            return

        yield event("status", {"phase": "executing"})
        try:
            ai: AIMessage = await bound.ainvoke(messages)
        except Exception as exc:  # noqa: BLE001 - 模型不可达/鉴权失败
            yield event(
                "error",
                {
                    "code": "E_LLM_UNAVAILABLE",
                    "messageKey": "error.llmUnavailable",
                    "params": {"reason": str(exc)},
                },
            )
            yield event("done", {"usage": {}})
            return

        tool_calls = list(getattr(ai, "tool_calls", []) or [])
        if not tool_calls:
            text = ai.content if isinstance(ai.content, str) else str(ai.content)
            for token in _tokenize(text):
                yield event("token", {"delta": token})
            break

        messages.append(ai)
        for call in tool_calls:
            call_id = call.get("id") or f"call_{step}"
            name = call.get("name", "")
            args = call.get("args") or {}
            started = time.monotonic()
            append_evidence(
                root,
                session_id=session_id,
                step="tool_call",
                tool=name,
                params=args,
                lang=locale or "zh-CN",
            )
            yield event("tool_call", {"callId": call_id, "tool": name, "params": args})
            try:
                result = execute_tool(name, args)
                ok = True
                summary = _summarize(result)
                if name == "report_finding":
                    yield event("finding", {"id": result["id"], "event": "created"})
            except Exception as exc:  # noqa: BLE001 - 工具失败回传摘要
                ok = False
                result = {"error": str(exc)}
                summary = str(exc)
            recorded = append_evidence(
                root,
                session_id=session_id,
                step="tool_result",
                tool=name,
                params=args,
                result_summary=summary,
                result=result,
                duration_ms=int((time.monotonic() - started) * 1000),
                lang=locale or "zh-CN",
            )
            evidence_ids.append(recorded["id"])
            yield event(
                "tool_result", {"callId": call_id, "summary": summary, "ok": ok}
            )
            messages.append(
                ToolMessage(content=_tool_message_content(result), tool_call_id=call_id)
            )
        yield event("status", {"phase": "reflecting"})

    yield event("done", {"usage": {}})


def _load_history(fe: Path, session_id: str) -> list[BaseMessage]:
    from ..store.sessions import get_messages

    history: list[BaseMessage] = []
    for item in get_messages(fe, session_id):
        content = item.get("content")
        text = content.get("text", "") if isinstance(content, dict) else str(content)
        if item.get("role") == "user":
            history.append(HumanMessage(content=text))
        elif item.get("role") == "assistant" and text:
            history.append(AIMessage(content=text))
    return history


async def stream_chat(
    session_id: str, message: str, locale: str | None = None
) -> AsyncIterator[dict[str, Any]]:
    from ..store.sessions import add_message
    from ..store.workspace import workspace_manager

    def _wrap(envelope: dict[str, Any]) -> dict[str, str]:
        return {"event": "message", "data": json.dumps(envelope, ensure_ascii=False)}

    root = workspace_manager.root
    if root is None:
        event = _event_factory(session_id)
        yield _wrap(event("status", {"phase": "planning"}))
        yield _wrap(
            event(
                "error",
                {
                    "code": "E_NO_WORKSPACE",
                    "messageKey": "error.noWorkspace",
                    "params": {},
                },
            )
        )
        yield _wrap(event("done", {"usage": {}}))
        return

    fe = root / ".fireeye"
    history = _load_history(fe, session_id)
    add_message(fe, root, session_id, "user", {"text": message})

    answer_parts: list[str] = []
    async for ev in run_agent(root, session_id, message, locale, history=history):
        if ev.get("type") == "token":
            answer_parts.append(str(ev.get("data", {}).get("delta", "")))
        yield _wrap(ev)

    answer = "".join(answer_parts).strip()
    if answer:
        add_message(fe, root, session_id, "assistant", {"text": answer})
