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
