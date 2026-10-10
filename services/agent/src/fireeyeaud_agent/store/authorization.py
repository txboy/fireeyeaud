"""数据库表 / 字段授权清单（设计 §14.9）。落盘 `.fireeye/authorization.json`。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_AUTHZ = "authorization.json"


def _path(root: Path) -> Path:
    return Path(root) / ".fireeye" / _AUTHZ


def _load(root: Path) -> dict[str, Any]:
    path = _path(root)
    if not path.exists():
        return {"connections": {}}
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"connections": {}}
    data.setdefault("connections", {})
    return data


def _save(root: Path, data: dict[str, Any]) -> None:
    path = _path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")


def get(root: Path, connection_id: str) -> dict[str, list[str]]:
    return _load(root)["connections"].get(connection_id, {})


def set_entry(root: Path, connection_id: str, tables: dict[str, list[str]]) -> None:
    data = _load(root)
    data["connections"][connection_id] = tables
    _save(root, data)


def table_allowed(root: Path, connection_id: str, table: str) -> bool:
    return table in get(root, connection_id)


def column_allowed(root: Path, connection_id: str, table: str, column: str) -> bool:
    cols = get(root, connection_id).get(table)
    if cols is None:
        return False
    return "*" in cols or column in cols
