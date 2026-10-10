"""describe_source：读取 schema.json，供 Agent 了解列结构（设计 §10.1 / §14.3）。

对数据库源（含 `connectionId`）按 §14.9 授权清单过滤：未授权的表整体隐藏，
已授权表的列仅返回被授权列（`*` 表示全部）。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..store.authorization import get as get_authorization
from ..store.index import load_schema


def describe_source(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    root = Path(root)
    entries = load_schema(root / ".fireeye" / "index" / "schema.json")
    source_id = params.get("sourceId")
    table = params.get("table")
    out: list[dict[str, Any]] = []
    for e in entries:
        if source_id and e.get("sourceId") != source_id:
            continue
        if table and e.get("table") != table:
            continue
        connection_id = e.get("connectionId")
        if connection_id:
            allowed = get_authorization(root, connection_id).get(e.get("table"))
            if allowed is None:
                continue
            if "*" not in allowed:
                entry = dict(e)
                entry["columns"] = [
                    c for c in e.get("columns", []) if c.get("name") in allowed
                ]
                out.append(entry)
                continue
        out.append(e)
    return {"tables": out}
