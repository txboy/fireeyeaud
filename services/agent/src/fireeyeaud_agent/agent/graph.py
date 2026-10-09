"""LangGraph 状态图（Phase 0 回显桩）。

当前用确定性回复占位，验证 `astream_events → SSE` 通道；Phase 1 接入真实模型与工具。
"""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from typing import Annotated, Any, TypedDict

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from ..util import now_iso


class AgentState(TypedDict, total=False):
    messages: Annotated[list[BaseMessage], add_messages]
    locale: str | None


def _reply_text(message: str, locale: str | None) -> str:
    if locale == "en-US":
        return (
            f'Received: "{message}". This is the Phase 0 streaming stub, '
            "used to verify the end-to-end SSE pipeline."
        )
    return (
        f"已收到：「{message}」。这是 Phase 0 的流式回显桩，用于打通端到端的 SSE 通道。"
    )


def _build_graph(text: str):
    model = GenericFakeChatModel(messages=iter([AIMessage(content=text)]))

    def plan(_state: AgentState) -> AgentState:
        return {}

    def generate(state: AgentState) -> AgentState:
        return {"messages": [model.invoke(state.get("messages", []))]}

    def reflect(_state: AgentState) -> AgentState:
        return {}

    graph = StateGraph(AgentState)
    graph.add_node("plan", plan)
    graph.add_node("generate", generate)
    graph.add_node("reflect", reflect)
    graph.add_edge(START, "plan")
    graph.add_edge("plan", "generate")
    graph.add_edge("generate", "reflect")
    graph.add_edge("reflect", END)
    return graph.compile()


def _message_text(message: Any) -> str:
    content = getattr(message, "content", message)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p if isinstance(p, str) else p.get("text", "") for p in content)
    return ""


def _tokenize(text: str) -> list[str]:
    """把整段文本切成小块，模拟 token 流（回显桩专用）。"""
    return re.findall(r"\s+|[^\s]{1,2}", text)


_PHASE_BY_NODE = {"plan": "planning", "generate": "executing", "reflect": "reflecting"}


async def stream_chat(
    session_id: str, message: str, locale: str | None = None
) -> AsyncIterator[dict[str, str]]:
    """产出一串 SSE 事件（信封见设计文档 §14.7）。"""
    seq = 0

    def event(etype: str, data: dict[str, Any]) -> dict[str, str]:
        nonlocal seq
        seq += 1
        envelope = {
            "type": etype,
            "seq": seq,
            "sessionId": session_id,
            "ts": now_iso(),
            "data": data,
        }
        return {"event": "message", "data": json.dumps(envelope, ensure_ascii=False)}

    yield event("status", {"phase": "planning"})
    yield event("thinking", {"text": "解析问题并规划步骤…"})

    graph = _build_graph(_reply_text(message, locale))
    inputs: AgentState = {"messages": [HumanMessage(content=message)], "locale": locale}

    tokens_sent = 0
    final_text = ""

    async for ev in graph.astream_events(inputs, version="v2"):
        kind = ev["event"]
        if kind == "on_chain_start":
            phase = _PHASE_BY_NODE.get(ev.get("name", ""))
            if phase:
                yield event("status", {"phase": phase})
        elif kind == "on_chat_model_stream":
            delta = _message_text(ev["data"]["chunk"])
            if delta:
                tokens_sent += 1
                yield event("token", {"delta": delta})
        elif kind == "on_chat_model_end":
            final_text = _message_text(ev["data"].get("output"))

    # 回显桩兜底：若模型未以流式回调产出 token，则按最终文本切块补发。
    if tokens_sent == 0 and final_text:
        for token in _tokenize(final_text):
            yield event("token", {"delta": token})

    yield event("done", {"usage": {}})
