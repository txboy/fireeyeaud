"""describe_source：读取 schema.json，供 Agent 了解列结构（设计 §10.1 / §14.3）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..store.index import load_schema


def describe_source(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    entries = load_schema(Path(root) / ".fireeye" / "index" / "schema.json")
    source_id = params.get("sourceId")
    table = params.get("table")
    out = [
        e
        for e in entries
        if (not source_id or e.get("sourceId") == source_id)
        and (not table or e.get("table") == table)
    ]
    return {"tables": out}
