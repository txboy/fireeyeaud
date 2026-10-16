"""上下文压缩：预算判定、增量摘要与持久化（Phase 9 · 方案 §4–§6）。

设计要点：
- 预算**每轮按当前模型重算**，不缓存（方案 §6.2）。
- 只压缩 `compactedUpTo` 之前的较早对话；system prompt 与本轮用户消息永不压缩。
- 摘要在 `compactedUpTo` 之上**增量并入**，落库（`store.sessions.set_summary`），
  不在每轮重生成；同一 seq 幂等，不越过边界则跳过（方案 §6.4）。
- 摘要仅供模型短期记忆，不承担取证职责（方案 §8）。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from ..config.settings import settings
from ..util import now_iso
from .token_budget import (
    Budget,
    compute_budget,
    estimate_tokens,
    resolve_context_window,
    resolve_reserve_output,
)

# provider 侧「上下文超限」错误的常见特征（小写子串匹配）。
_OVERFLOW_MARKERS = (
    "context length",
    "context_length",
    "context window",
    "maximum context",
    "max context",
    "maximum number of tokens",
    "too many tokens",
    "reduce the length",
    "token limit",
    "exceeds the maximum",
    "string too long",
)
_OVERFLOW_CODES = {
    "context_length_exceeded",
    "context_window_exceeded",
    "string_above_max_length",
    "max_tokens_exceeded",
}

_SUMMARY_SYSTEM_ZH = (
    "你是审计会话的上下文压缩器。把给定的较早期对话压缩成一段简洁摘要，"
    "保留与审计任务相关的事实：用户目标与约束、已确认的数据源/表结构、"
    "关键口径与结论、已记录的疑点线索、未完成的待办。不要加入推测，不要寒暄，"
    "直接输出摘要正文。"
)
_SUMMARY_SYSTEM_EN = (
    "You compress an audit session's earlier turns into a concise summary. "
    "Preserve task-relevant facts: user goals and constraints, confirmed data "
    "sources/tables, key criteria and conclusions, recorded findings, and open "
    "threads. No speculation, no preamble — output the summary body only."
)


@dataclass
class CompactionResult:
    compacted: bool
    summary: dict[str, Any] | None
    summarized_up_to: int
    tokens_before: int
    tokens_after: int
    window: int
    model_id: str | None
    trigger: int


def is_context_overflow(exc: BaseException | str) -> bool:
    """判断异常是否为 provider 的上下文超限（方案 §6.2 第 7 条）。"""
    if isinstance(exc, BaseException):
        code = getattr(exc, "code", None) or getattr(exc, "type", None)
        if isinstance(code, str) and code.lower() in _OVERFLOW_CODES:
            return True
        text = str(exc)
    else:
        text = exc
    lowered = text.lower()
    if any(code in lowered for code in _OVERFLOW_CODES):
        return True
    return any(marker in lowered for marker in _OVERFLOW_MARKERS)


def _normalize(entries: list[dict[str, Any]]) -> list[tuple[int, str, str]]:
    """归一化为 [(seq, role, text)]，保留 user/assistant 且有正文的条目。"""
    out: list[tuple[int, str, str]] = []
    for item in entries or []:
        role = str(item.get("role") or "")
        text = str(item.get("text") or "")
        if role in ("user", "assistant") and text.strip():
            out.append((int(item.get("seq") or 0), role, text))
    out.sort(key=lambda row: row[0])
    return out


def plan_compaction(
    entries: list[dict[str, Any]],
    *,
    keep_tokens: int,
    previous_up_to: int = 0,
) -> int | None:
    """决定本次并入摘要的 seq 上界。

    从最新往回保留消息，直到累计 token 超过 `keep_tokens`；返回其前一条的 seq。
    若无需压缩（全部保留）则返回 None。**最新一条永不被压缩**（§4.2 不变量）。
    """
    fresh = [(seq, text) for seq, _role, text in _normalize(entries) if seq > previous_up_to]
    if not fresh:
        return None
    kept = 0
    keep_from = len(fresh)
    for index in range(len(fresh) - 1, -1, -1):
        cost = estimate_tokens(fresh[index][1])
        if kept > 0 and kept + cost > keep_tokens:
            break
        kept += cost
        keep_from = index
    if keep_from == 0:
        return None
    return fresh[keep_from - 1][0]


def fold_transcript(
    entries: list[dict[str, Any]], *, after_up_to: int, up_to: int
) -> str:
    """把 seq∈(after_up_to, up_to] 的对话渲染为增量合并的文本。"""
    lines: list[str] = []
    for seq, role, text in _normalize(entries):
        if after_up_to < seq <= up_to:
            lines.append(f"[{role} #{seq}] {text}")
    return "\n".join(lines)


def summary_message(summary: dict[str, Any]) -> SystemMessage:
    """把摘要注入为 system prompt 之后、保留区之前的特殊消息（§4.2）。"""
    up_to = int(summary.get("upTo") or 0)
    text = str(summary.get("text") or "")
    content = (
        f"【上下文压缩摘要】以下为此前对话压缩后的摘要（截至消息 #{up_to}）。"
        "仅作为背景参考，不作为取证依据；若与工具结果或证据冲突，以证据为准。\n\n"
        f"{text}"
    )
    return SystemMessage(content=content)


def _message_content(message: BaseMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for block in content or []:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text") or ""))
        elif isinstance(block, str):
            parts.append(block)
    return "\n".join(parts)


async def make_summary(
    model: Any,
    previous_text: str,
    transcript: str,
    *,
    locale: str | None = None,
) -> str:
    """用模型把（旧摘要 + 新增对话）压缩为一段新摘要。"""
    system = _SUMMARY_SYSTEM_EN if locale == "en-US" else _SUMMARY_SYSTEM_ZH
    parts: list[str] = []
    if previous_text.strip():
        parts.append(f"已有摘要（在此基础上增量更新）：\n{previous_text.strip()}")
    parts.append(f"需要并入的较早期对话：\n{transcript}")
    response = await model.ainvoke(
        [SystemMessage(content=system), HumanMessage(content="\n\n".join(parts))]
    )
    if isinstance(response, AIMessage):
        return _message_content(response).strip()
    content = getattr(response, "content", response)
    return _message_content(AIMessage(content=content)).strip()


def _app_value(app: dict[str, Any], key: str, fallback):
    value = app.get(key)
    return value if value is not None else fallback


async def prepare(
    fe: Path,
    session_id: str,
    *,
    entries: list[dict[str, Any]],
    system_text: str,
    new_turn_text: str,
    model: Any,
    model_id: str | None,
    profile: dict[str, Any] | None,
    locale: str | None = None,
    settings_obj: Any = settings,
    app_compaction: dict[str, Any] | None = None,
    force: bool = False,
) -> CompactionResult:
    """每轮发送前的压缩决策与执行（方案 §6.3）。

    `entries` 为**本轮之前**的历史条目（不含 system prompt 与本轮用户消息），
    每项 {seq, role, text}。
    """
    from ..store import sessions as sessions_store

    app = app_compaction or {}
    window = resolve_context_window(
        profile, default=settings_obj.default_context_window
    )
    reserve = int(
        _app_value(
            app,
            "reserveOutputTokens",
            resolve_reserve_output(
                profile, default=settings_obj.compact_reserve_output_tokens
            ),
        )
    )
    threshold = float(_app_value(app, "threshold", 0.9))
    budget: Budget = compute_budget(
        window=window,
        reserve_output=reserve,
        safety_factor=settings_obj.context_safety_factor,
        threshold=threshold,
    )

    normalized = _normalize(entries)
    history_tokens = sum(estimate_tokens(text) for _seq, _role, text in normalized)
    estimated = (
        estimate_tokens(system_text) + history_tokens + estimate_tokens(new_turn_text)
    )

    existing = sessions_store.get_summary(fe, session_id)
    auto = bool(_app_value(app, "auto", True))

    def _result(compacted: bool, up_to: int, after: int, summary) -> CompactionResult:
        return CompactionResult(
            compacted=compacted,
            summary=summary,
            summarized_up_to=up_to,
            tokens_before=estimated,
            tokens_after=after,
            window=window,
            model_id=model_id,
            trigger=budget.trigger,
        )

    if not force and (not auto or estimated <= budget.trigger):
        return _result(False, existing["upTo"] if existing else 0, estimated, existing)

    if model is None:
        return _result(False, existing["upTo"] if existing else 0, estimated, existing)

    keep = int(
        _app_value(
            app, "keepTokens", min(settings_obj.compact_keep_tokens, int(window * 0.5))
        )
    )
    keep = min(keep, max(1, int(window * 0.5)))
    previous_up_to = int(existing["upTo"]) if existing else 0
    new_up_to = plan_compaction(
        entries, keep_tokens=keep, previous_up_to=previous_up_to
    )
    if (new_up_to is None or new_up_to <= previous_up_to) and force:
        # 强制压缩（溢出兜底）：至少把最新一条之外的内容并入摘要（§6.2 第 7 条）。
        fresh = [seq for seq, _role, _text in normalized if seq > previous_up_to]
        if len(fresh) >= 2:
            new_up_to = fresh[-2]
    if new_up_to is None or new_up_to <= previous_up_to:
        # 幂等：未越过边界则跳过（方案 §6.4）。
        return _result(
            False, previous_up_to, estimated, existing
        )

    transcript = fold_transcript(
        entries, after_up_to=previous_up_to, up_to=new_up_to
    )
    new_text = await make_summary(
        model,
        existing["text"] if existing else "",
        transcript,
        locale=locale,
    )
    summary = {"text": new_text, "upTo": new_up_to, "createdAt": now_iso()}
    sessions_store.set_summary(
        fe, session_id, summary, model_id=model_id, window=window
    )

    removed = sum(
        estimate_tokens(text)
        for seq, _role, text in normalized
        if previous_up_to < seq <= new_up_to
    )
    tokens_after = estimated - removed + estimate_tokens(new_text)
    stored = sessions_store.get_summary(fe, session_id)
    return _result(True, new_up_to, tokens_after, stored)
