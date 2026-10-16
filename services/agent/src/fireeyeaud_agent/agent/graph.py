"""Agent 循环：plan → tool_call → reflect（Phase 1）。

设计 §7 / §14.7。真实模型经 OpenAI-compatible 接口；工具为进程内 LangChain 工具。
模型调用采用 `astream` 流式产出 `token` 事件，并以整体超时兜底。
"""

from __future__ import annotations

import asyncio
import inspect
import json
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

from ..config.models import build_chat_model, select_profile
from ..config.settings import settings
from ..store import app_settings
from ..store.evidence import append_evidence
from ..store.findings import create_finding
from ..tools.registry import build_langchain_tools, build_tool_dict
from ..util import now_iso
from .compaction import is_context_overflow, prepare, summary_message
from .token_budget import estimate_messages_tokens, estimate_tokens, resolve_context_window
from .prompts import system_prompt
from .context_snapshot import build_snapshot


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


_MAX_LOG_CHARS = 2000


def _log_block(block: Any, *, cap: int = _MAX_LOG_CHARS) -> str:
    """把单个消息内容块渲染为可读日志（图像只记长度，避免刷屏）。"""
    if isinstance(block, str):
        return block[:cap] + ("…（截断）" if len(block) > cap else "")
    if isinstance(block, dict):
        kind = block.get("type")
        if kind == "image_url":
            url = str((block.get("image_url") or {}).get("url") or "")
            head = url.split(",", 1)[0]
            return f"<image {head} · {len(url)} chars>"
        if kind == "text":
            text = str(block.get("text") or "")
            return text[:cap] + ("…（截断）" if len(text) > cap else "")
    return str(block)


def format_llm_request(messages: list[BaseMessage], *, step: int | None = None) -> str:
    """把即将发给大模型的 messages 渲染成日志文本。"""
    title = "LLM request" + (f" (step {step})" if step is not None else "")
    lines = [f"===== {title} | {len(messages)} messages ====="]
    for index, item in enumerate(messages):
        role = item.__class__.__name__
        content = item.content
        if isinstance(content, str):
            rendered = _log_block(content)
        else:
            rendered = " | ".join(_log_block(block) for block in content)
        lines.append(f"[{index}] {role}: {rendered}")
    lines.append("===== end LLM request =====")
    return "\n".join(lines)


def format_llm_response(ai: AIMessage, *, step: int | None = None) -> str:
    """把大模型返回的内容/工具调用/reasoning 渲染成日志文本。"""
    title = "LLM response" + (f" (step {step})" if step is not None else "")
    content = ai.content
    text = content if isinstance(content, str) else " | ".join(
        _log_block(block) for block in content
    )
    calls = list(getattr(ai, "tool_calls", []) or [])
    extra = getattr(ai, "additional_kwargs", {}) or {}
    reasoning = extra.get("reasoning_content") or extra.get("reasoning")
    lines = [
        f"===== {title} | content={len(text)} chars | tool_calls={len(calls)} ====="
    ]
    if text:
        lines.append(f"content: {text[:2000]}{'…（截断）' if len(text) > 2000 else ''}")
    else:
        lines.append("content: <空>")
    if reasoning:
        shown = str(reasoning)
        lines.append(
            f"reasoning: {shown[:1000]}{'…（截断）' if len(shown) > 1000 else ''}"
        )
    for call in calls:
        args = json.dumps(call.get("args"), ensure_ascii=False)
        lines.append(f"tool_call: {call.get('name')} args={args}")
    lines.append("===== end LLM response =====")
    return "\n".join(lines)


def _maybe_bind(model: Any, tools: list[StructuredTool]) -> Any:
    try:
        return model.bind_tools(tools)
    except NotImplementedError:
        return model
    except Exception:  # noqa: BLE001 - 绑定失败则退回未绑定模型
        return model


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
        if "entries" in result:
            return f"{len(result['entries'])} 项"
        if "matches" in result:
            return f"{len(result['matches'])} 处命中"
        if "text" in result:
            if result.get("error"):
                return str(result.get("message") or result["error"])
            return f"{result.get('kind', 'file')} · {len(result['text'])} 字"
        if "id" in result:
            return str(result["id"])
    return json.dumps(result, ensure_ascii=False, default=str)[:200]


def _tool_message_content(result: Any) -> str:
    return json.dumps(result, ensure_ascii=False, default=str)


def _allowed_ids(items: list[dict[str, Any]], selected: Any) -> set[str]:
    """默认（isDefault）∪ 勾选 → 允许集合。"""
    ids = {str(i.get("id")) for i in items if i.get("isDefault")}
    ids |= {str(s) for s in (selected or [])}
    return ids


def _registry_context(
    root: Path, context: dict[str, Any] | None
) -> dict[str, Any] | None:
    """按「默认 ∪ 勾选」计算数据库连接 / 知识库 Provider 的允许集合。

    `context is None` 表示未启用上下文（旧行为，不做限制）。
    """
    if context is None:
        return None
    from ..store import db as db_store
    from ..store import knowledge as kb_store
    from ..store import rules as rules_store

    return {
        "allowedConnectionIds": _allowed_ids(
            db_store.list_connections(root), context.get("dbConnectionIds")
        ),
        "allowedProviderIds": _allowed_ids(
            kb_store.list_providers(root), context.get("kbProviderIds")
        ),
        "allowedRuleIds": _allowed_ids(
            [r for r in rules_store.list_rules(root) if r.get("enabled") and r.get("sql")],
            context.get("ruleIds"),
        ),
    }


async def run_agent(
    root: Path,
    session_id: str,
    message: str,
    locale: str | None = None,
    *,
    model: Any = None,
    model_id: str | None = None,
    history: list[BaseMessage] | None = None,
    history_entries: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    attachment_texts: list[dict[str, Any]] | None = None,
    image_blocks: list[dict[str, Any]] | None = None,
    options: dict[str, Any] | None = None,
    event_factory: Any = None,
) -> AsyncIterator[dict[str, Any]]:
    root = Path(root)
    event = event_factory or _event_factory(session_id)
    fe = root / ".fireeye"
    active_model = model or build_chat_model(root, model_id)
    registry_ctx = _registry_context(root, context)
    build_file_model = lambda: build_chat_model(root, model_id)  # noqa: E731
    tools = [
        *build_langchain_tools(
            root,
            registry_ctx,
            model_id=model_id,
            build_model=build_file_model,
        ),
        _report_finding_tool(),
    ]
    bound = _maybe_bind(active_model, tools)
    tool_dict = build_tool_dict(
        root, registry_ctx, model_id=model_id, build_model=build_file_model
    )

    from ..store.rules import list_rules
    from ..store.skills import prompts_for

    enabled_rules = [r for r in list_rules(root) if r.get("enabled") and r.get("sql")]
    if registry_ctx is not None:
        allowed_rules = registry_ctx.get("allowedRuleIds") or set()
        rules = [r for r in enabled_rules if str(r.get("id")) in allowed_rules]
    else:
        rules = enabled_rules
    skill_prompts = prompts_for(root, (context or {}).get("skillIds"))
    custom_prompt = (app_settings.load().get("systemPrompt") or "").strip() or None
    system_text = system_prompt(locale, rules, skill_prompts, custom_prompt)
    messages: list[BaseMessage] = [SystemMessage(content=system_text)]

    yield event("status", {"phase": "planning"})
    if options is not None:
        yield event("context", {"options": options})

    # 附件文本（本地抽取 + 视觉转写）并入用户消息正文；图片/扫描页在首步直传原图。
    from ..store.attachments import render_attachment_texts

    texts = list(attachment_texts or [])
    blocks = list(image_blocks or [])
    local_block = render_attachment_texts(
        [t for t in texts if t.get("source") == "local"]
    )
    step1_text = message + (f"\n\n{local_block}" if local_block else "")

    # 本轮用户消息（首步可能携带原图内容块）。
    if blocks:
        current_message = HumanMessage(
            content=[{"type": "text", "text": step1_text}, *blocks]
        )
    else:
        current_message = HumanMessage(content=step1_text)

    app_compact: dict[str, Any] = {}
    profile: dict[str, Any] | None = None
    active_summary: dict[str, Any] | None = None

    # 上下文压缩（Phase 9）：按当前模型预算，必要时把较早对话并入摘要。
    if history_entries is not None:
        from ..store.sessions import get_summary

        app_compact = app_settings.load().get("compaction") or {}
        profile = select_profile(root, model_id)
        yield event("status", {"phase": "compacting"})
        result = await prepare(
            fe,
            session_id,
            entries=history_entries,
            system_text=system_text,
            new_turn_text=step1_text,
            model=active_model,
            model_id=model_id,
            profile=profile,
            locale=locale,
            app_compaction=app_compact,
        )
        if result.compacted:
            yield event("compaction", _compaction_data(result, model_id))
        active_summary = result.summary or get_summary(fe, session_id)
        messages.extend(_entries_to_messages(history_entries, active_summary))
    elif history:
        messages.extend(history)

    messages.append(current_message)
    human_index = len(messages) - 1

    def _usage() -> dict[str, Any]:
        """done 事件的用量：最近估算总 token 与当前模型窗口（方案 §4.5）。"""
        return {
            "tokensEstimated": estimate_messages_tokens(messages),
            "contextWindow": resolve_context_window(
                profile, default=settings.default_context_window
            ),
        }

    evidence_ids: list[str] = []

    async def execute_tool(name: str, args: dict[str, Any]) -> Any:
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
        value = tool_dict[name](root, args)
        return await value if inspect.isawaitable(value) else value

    step = 0
    overflow_retried = False
    while True:
        step += 1
        if step > settings.max_steps:
            yield event("done", {"usage": _usage(), "messageKey": "error.agentLimit"})
            return

        yield event("status", {"phase": "executing"})
        # 每次发给大模型的参数打印到 sidecar 控制台（Electron 主进程日志）。
        print(format_llm_request(messages, step=step), flush=True)
        ai: AIMessage | None = None
        try:
            # 流式调用：内容边生成边推送 token，避免长时间黑屏。
            # 用整体超时兜底：服务端持续发送空块（推理阶段）时，HTTP 读超时不会触发。
            async with asyncio.timeout(settings.turn_timeout_seconds):
                async for chunk in bound.astream(messages):
                    ai = chunk if ai is None else ai + chunk
                    piece = chunk.content
                    if isinstance(piece, str) and piece:
                        yield event("token", {"delta": piece})
        except TimeoutError:
            print(
                f"===== LLM timeout (step {step}) after "
                f"{settings.turn_timeout_seconds}s =====",
                flush=True,
            )
            yield event(
                "error",
                {
                    "code": "E_LLM_TIMEOUT",
                    "messageKey": "error.llmTimeout",
                    "params": {},
                },
            )
            yield event("done", {"usage": _usage()})
            return
        except Exception as exc:  # noqa: BLE001 - 模型不可达/鉴权失败/超时
            # 溢出兜底：provider 报上下文超限 → 强制压缩一次并重试一次（§4.4/§6.2）。
            if (
                is_context_overflow(exc)
                and history_entries is not None
                and not overflow_retried
            ):
                overflow_retried = True
                print(
                    f"===== LLM context overflow (step {step}) — forcing "
                    f"compaction and retrying =====\n{exc!r}",
                    flush=True,
                )
                from ..store.sessions import get_summary

                forced = await prepare(
                    fe,
                    session_id,
                    entries=history_entries,
                    system_text=system_text,
                    new_turn_text=step1_text,
                    model=active_model,
                    model_id=model_id,
                    profile=profile,
                    locale=locale,
                    app_compaction=app_compact,
                    force=True,
                )
                active_summary = forced.summary or get_summary(fe, session_id)
                rebuilt: list[BaseMessage] = [SystemMessage(content=system_text)]
                rebuilt.extend(
                    _entries_to_messages(history_entries, active_summary)
                )
                rebuilt.append(current_message)
                messages[:] = rebuilt
                human_index = len(messages) - 1
                if forced.compacted:
                    yield event("compaction", _compaction_data(forced, model_id))
                continue
            print(
                f"===== LLM error (step {step}) =====\n{exc!r}\n===== end LLM error =====",
                flush=True,
            )
            yield event(
                "error",
                {
                    "code": "E_LLM_UNAVAILABLE",
                    "messageKey": "error.llmUnavailable",
                    "params": {
                        "reason": str(exc),
                        "tokensEstimated": estimate_tokens(system_text)
                        + sum(
                            estimate_tokens(str(e.get("text") or ""))
                            for e in (history_entries or [])
                        )
                        + estimate_tokens(step1_text),
                    },
                },
            )
            yield event("done", {"usage": _usage()})
            return

        if ai is None:
            yield event(
                "error",
                {
                    "code": "E_LLM_UNAVAILABLE",
                    "messageKey": "error.llmUnavailable",
                    "params": {},
                },
            )
            yield event("done", {"usage": _usage()})
            return

        print(format_llm_response(ai, step=step), flush=True)

        tool_calls = list(getattr(ai, "tool_calls", []) or [])
        if not tool_calls:
            text = ai.content if isinstance(ai.content, str) else str(ai.content)
            if not text.strip():
                # 模型只产出推理、没有正文：明确报错，避免静默无回复。
                yield event(
                    "error",
                    {
                        "code": "E_EMPTY_RESPONSE",
                        "messageKey": "error.emptyResponse",
                        "params": {},
                    },
                )
            break

        # 首步已把原图直传给模型；从第 2 步起改为文本（附件文本），避免重复上传图片。
        if step == 1 and blocks:
            full_block = render_attachment_texts(texts)
            messages[human_index] = HumanMessage(
                content=message + (f"\n\n{full_block}" if full_block else "")
            )

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
                result = await execute_tool(name, args)
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

    usage = _usage()
    from ..store.sessions import set_tokens_estimate

    set_tokens_estimate(fe, session_id, usage["tokensEstimated"])
    yield event("done", {"usage": usage})


async def compact_session_manual(
    root: Path, session_id: str, model_id: str | None = None
) -> dict[str, Any]:
    """手动压缩（`POST /sessions/{id}/compact`，方案 §4.4 第 3 条）。

    强制压缩一次（不受阈值与 auto 限制），返回压缩后的估算。
    """
    root = Path(root)
    fe = root / ".fireeye"
    from ..store.rules import list_rules
    from ..store.sessions import list_sessions

    if model_id is None:
        model_id = next(
            (
                item.get("modelId")
                for item in list_sessions(fe)
                if item.get("id") == session_id
            ),
            None,
        )
    entries = _history_entries(fe, session_id)
    enabled_rules = [r for r in list_rules(root) if r.get("enabled") and r.get("sql")]
    custom_prompt = (app_settings.load().get("systemPrompt") or "").strip() or None
    system_text = system_prompt(None, enabled_rules, None, custom_prompt)
    app_compact = app_settings.load().get("compaction") or {}
    profile = select_profile(root, model_id)
    model = build_chat_model(root, model_id)
    result = await prepare(
        fe,
        session_id,
        entries=entries,
        system_text=system_text,
        new_turn_text="",
        model=model,
        model_id=model_id,
        profile=profile,
        app_compaction=app_compact,
        force=True,
    )
    return {
        "compacted": result.compacted,
        "summarizedUpTo": result.summarized_up_to,
        "tokensBefore": result.tokens_before,
        "tokensAfter": result.tokens_after,
        "modelId": model_id,
        "window": result.window,
    }


def _entries_to_messages(
    entries: list[dict[str, Any]], summary: dict[str, Any] | None
) -> list[BaseMessage]:
    """把历史条目渲染为 messages：摘要在前，`upTo` 之后的原始对话保留在后。"""
    out: list[BaseMessage] = []
    if summary and summary.get("text"):
        out.append(summary_message(summary))
    up_to = int((summary or {}).get("upTo") or 0)
    for entry in entries:
        if int(entry.get("seq") or 0) <= up_to:
            continue
        if entry.get("role") == "user":
            out.append(HumanMessage(content=str(entry.get("text") or "")))
        elif entry.get("text"):
            out.append(AIMessage(content=str(entry["text"])))
    return out


def _compaction_data(result: Any, model_id: str | None) -> dict[str, Any]:
    return {
        "phase": "done",
        "summarizedUpTo": result.summarized_up_to,
        "tokensBefore": result.tokens_before,
        "tokensAfter": result.tokens_after,
        "modelId": model_id,
        "window": result.window,
    }


def _history_entries(fe: Path, session_id: str) -> list[dict[str, Any]]:
    """把会话消息投影为本轮之前的 [{seq, role, text}]（供压缩与历史回放）。"""
    from ..store.attachments import render_attachment_texts
    from ..store.sessions import get_messages

    entries: list[dict[str, Any]] = []
    for item in get_messages(fe, session_id):
        content = item.get("content")
        text = content.get("text", "") if isinstance(content, dict) else str(content)
        role = item.get("role")
        if role == "user":
            if isinstance(content, dict):
                text = _compose_user_message(text, content.get("mentions") or [])
                block = render_attachment_texts(content.get("attachmentTexts") or [])
                if block:
                    text = f"{text}\n\n{block}"
            entries.append({"seq": item.get("seq"), "role": "user", "text": text})
        elif role == "assistant" and text:
            entries.append(
                {"seq": item.get("seq"), "role": "assistant", "text": text}
            )
    return entries


def _load_history(fe: Path, session_id: str) -> list[BaseMessage]:
    history: list[BaseMessage] = []
    for entry in _history_entries(fe, session_id):
        if entry["role"] == "user":
            history.append(HumanMessage(content=entry["text"]))
        else:
            history.append(AIMessage(content=entry["text"]))
    return history


def _normalize_attachments(attachments: list[dict] | None) -> list[dict[str, str]]:
    """把随消息发送的附件归一化为 [{name, path}]（供消息下方展示与历史回放）。"""
    out: list[dict[str, str]] = []
    for item in attachments or []:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "")
        if not path:
            continue
        out.append({"name": str(item.get("name") or path), "path": path})
    return out


def _normalize_mentions(mentions: list[dict] | None) -> list[dict[str, Any]]:
    """把 @ 引用的工作区条目归一化为 [{path, name, isDir}]（path 恒为工作区相对 POSIX）。"""
    out: list[dict[str, Any]] = []
    for item in mentions or []:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "").strip().replace("\\", "/")
        if not path:
            continue
        name = str(item.get("name") or path.rsplit("/", 1)[-1])
        out.append({"path": path, "name": name, "isDir": bool(item.get("isDir"))})
    return out


def _compose_user_message(message: str, mentions: list[dict[str, Any]]) -> str:
    """把 @ 引用注记并入用户消息正文（仅在喂给模型时合成；持久化保留原文）。"""
    text = (message or "").strip()
    if not mentions:
        return text
    lines = ["（用户用 @ 引用了以下工作区条目："]
    for item in mentions:
        kind = "目录" if item.get("isDir") else "文件"
        lines.append(f"- @{item.get('path')}（{kind}）")
    lines.append("需要时用 list_files / read_file 读取。）")
    note = "\n".join(lines)
    return f"{text}\n\n{note}" if text else note



async def stream_chat(
    session_id: str,
    message: str,
    locale: str | None = None,
    model_id: str | None = None,
    context: dict[str, Any] | None = None,
    attachments: list[dict] | None = None,
    mentions: list[dict] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    from ..store.sessions import add_message
    from ..store.workspace import workspace_manager
    from .attachment_reader import AttachmentReadResult, read_attachments

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
    event = _event_factory(session_id)
    history_entries = _history_entries(fe, session_id)
    snapshot = build_snapshot(root, context, model_id)

    # 发送即读：把附件一次性转成文本（本地抽取 / 视觉转写），供本轮与后续轮次使用。
    read = AttachmentReadResult()
    if attachments:
        yield _wrap(event("status", {"phase": "reading"}))
        read = await read_attachments(
            root,
            model_id,
            attachments,
            build_model=lambda: build_chat_model(root, model_id),
        )
        if read.unsupported:
            yield _wrap(
                event(
                    "notice",
                    {
                        "messageKey": "attachmentUnsupported",
                        "params": {"files": "、".join(read.unsupported)},
                    },
                )
            )

    attachment_texts = [t.as_dict() for t in read.texts]
    mention_list = _normalize_mentions(mentions)
    agent_message = _compose_user_message(message, mention_list)
    add_message(
        fe,
        root,
        session_id,
        "user",
        {
            "text": message,
            "options": snapshot,
            "attachments": _normalize_attachments(attachments),
            "attachmentTexts": attachment_texts,
            "mentions": mention_list,
        },
    )

    answer_parts: list[str] = []
    async for ev in run_agent(
        root,
        session_id,
        agent_message,
        locale,
        model_id=model_id,
        history_entries=history_entries,
        context=context,
        attachment_texts=attachment_texts,
        image_blocks=read.image_blocks,
        options=snapshot,
        event_factory=event,
    ):
        if ev.get("type") == "token":
            answer_parts.append(str(ev.get("data", {}).get("delta", "")))
        yield _wrap(ev)

    answer = "".join(answer_parts).strip()
    if answer:
        add_message(fe, root, session_id, "assistant", {"text": answer})
