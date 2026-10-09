"""工具基座：artifacts 落盘与结果摘要（设计 §10.1 / §17.3）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Sequence


def dump_artifact(root: Path, name: str, payload: Any) -> str:
    """把大结果写入 `.fireeye/artifacts/<name>.json`，返回相对 ref。"""
    rel = f"artifacts/{name}.json"
    target = Path(root) / ".fireeye" / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")
    return rel


def summarize(rows: Sequence[Any], limit: int) -> dict[str, Any]:
    """截断结果并标注 rowCount / truncated。"""
    total = len(rows)
    head = list(rows[:limit])
    return {"rows": head, "rowCount": total, "truncated": total > limit}
