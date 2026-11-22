"""工具结果渲染：字符预算 + 头尾截断 + 大结果外置 artifact。"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from ..tools.base import dump_artifact


def render_tool_result(
    result: Any,
    *,
    tool: str,
    root: Path | None,
    max_chars: int,
) -> str:
    """把工具返回值渲染成送给模型的字符串。

    - 不超过预算：原样 JSON，行为与旧版一致。
    - 超过预算：落盘完整结果，只回传 head/tail 预览与 artifactRef，
      让模型用 read_artifact 按需回读，而不是把上下文一次打满。
    """
    text = json.dumps(result, ensure_ascii=False, default=str)
    if len(text) <= max_chars:
        return text

    artifact_ref = None
    if root is not None:
        artifact_ref = dump_artifact(
            Path(root),
            f"tool_{tool}_{uuid.uuid4().hex[:8]}",
            result,
        )

    head_chars = int(max_chars * 0.6)
    tail_chars = int(max_chars * 0.25)
    payload = {
        "truncated": True,
        "tool": tool,
        "originalChars": len(text),
        "head": text[:head_chars],
        "tail": text[-tail_chars:],
        "artifactRef": artifact_ref,
        "hint": (
            "结果过长已截断。需要完整数据时调用 read_artifact(artifactRef, offset, limit)，"
            "不要重复执行同一查询。"
        ),
    }
    return json.dumps(payload, ensure_ascii=False, default=str)


def prune_tool_messages(
    messages: list[Any], *, keep_last: int = 4, max_chars: int = 600
) -> int:
    """把较早的 ToolMessage 压缩成「已裁剪 + 摘要头尾」，返回实际裁剪条数。

    只动工具观察，不动用户/AI 文本；最近 keep_last 条保持原样。
    """
    from langchain_core.messages import ToolMessage

    tool_indexes = [
        i for i, m in enumerate(messages) if isinstance(m, ToolMessage)
    ]
    targets = tool_indexes[: max(0, len(tool_indexes) - keep_last)]
    changed = 0
    for i in targets:
        content = messages[i].content
        if not isinstance(content, str) or len(content) <= max_chars:
            continue
        head = content[: int(max_chars * 0.7)]
        tail = content[-int(max_chars * 0.2) :]
        messages[i] = ToolMessage(
            content=f"{head}\n…[已裁剪 {len(content)} 字符]…\n{tail}",
            tool_call_id=messages[i].tool_call_id,
        )
        changed += 1
    return changed
