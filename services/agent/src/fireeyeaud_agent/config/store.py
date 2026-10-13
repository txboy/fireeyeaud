"""配置项存储：global/project 作用域合并与 CRUD（设计 §14.8 / §17）。

- 全局配置：`<global_dir>/config/<kind>.json`
- 项目配置：`<root>/.fireeye/config/<kind>.json`
- 同 id 的项目项覆盖全局项（`load_effective`）。
- ID 计数存于 `<global_dir>/config/_counters.json`。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..util import now_iso
from .settings import settings

_ID_PREFIX = {
    "models": "mdl",
    "db": "conn",
    "knowledge": "kb",
    "mcp": "mcp",
    "skills": "sk",
    "rules": "rule",
}


def global_config_dir() -> Path:
    override = os.environ.get("FIREYEAUD_GLOBAL_DIR")
    base = (
        Path(override).expanduser()
        if override
        else Path(settings.global_dir).expanduser()
    )
    return base / "config"


def project_config_dir(root: Path) -> Path:
    return Path(root) / ".fireeye" / "config"


def _scope_dir(kind: str, scope: str, root: Path | None) -> Path:
    if scope == "project":
        if root is None:
            raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
        return project_config_dir(root)
    return global_config_dir()


def _items_path(kind: str, scope: str, root: Path | None) -> Path:
    return _scope_dir(kind, scope, root) / f"{kind}.json"


def _read_items(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(data, dict):
        items = data.get("items", [])
        return items if isinstance(items, list) else []
    return []


def _write_items(path: Path, items: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"items": items}, ensure_ascii=False, indent=2), "utf-8")


def list_items(kind: str, scope: str, root: Path | None = None) -> list[dict[str, Any]]:
    return _read_items(_items_path(kind, scope, root))


def load_effective(kind: str, root: Path | None = None) -> list[dict[str, Any]]:
    """全局项为基础，项目项按 id 覆盖（项目 scope 标记保留）。"""
    merged: dict[str, dict[str, Any]] = {
        item["id"]: item for item in list_items(kind, "global") if item.get("id")
    }
    if root is not None:
        for item in list_items(kind, "project", root):
            if item.get("id"):
                merged[item["id"]] = {**item, "scope": "project"}
    return list(merged.values())


def _next_id(kind: str) -> str:
    counters_path = global_config_dir() / "_counters.json"
    counters: dict[str, int] = {}
    if counters_path.exists():
        try:
            loaded = json.loads(counters_path.read_text("utf-8"))
            if isinstance(loaded, dict):
                counters = {k: int(v) for k, v in loaded.items()}
        except (OSError, json.JSONDecodeError):
            counters = {}
    value = counters.get(kind, 0) + 1
    counters[kind] = value
    counters_path.parent.mkdir(parents=True, exist_ok=True)
    counters_path.write_text(
        json.dumps(counters, ensure_ascii=False, indent=2), "utf-8"
    )
    prefix = _ID_PREFIX.get(kind, kind)
    return f"{prefix}_{value}"


def create_item(
    kind: str, data: dict[str, Any], root: Path | None = None
) -> dict[str, Any]:
    item = dict(data)
    scope = item.get("scope") or "global"
    if scope not in ("global", "project"):
        raise ApiError("E_INVALID_SCOPE", 400, "error.internal")
    item["id"] = _next_id(kind)
    item["scope"] = scope
    ts = now_iso()
    item.setdefault("createdAt", ts)
    item["updatedAt"] = ts
    items = list_items(kind, scope, root)
    items.append(item)
    _write_items(_items_path(kind, scope, root), items)
    return item


def update_item(
    kind: str,
    item_id: str,
    scope: str,
    patch: dict[str, Any],
    root: Path | None = None,
    *,
    drop_none: bool = True,
) -> dict[str, Any]:
    items = list_items(kind, scope, root)
    for index, item in enumerate(items):
        if item.get("id") == item_id:
            applied = (
                {k: v for k, v in patch.items() if v is not None}
                if drop_none
                else dict(patch)
            )
            updated = {
                **item,
                **applied,
                "id": item_id,
                "scope": scope,
                "updatedAt": now_iso(),
            }
            items[index] = updated
            _write_items(_items_path(kind, scope, root), items)
            return updated
    raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": item_id})


def put_item(
    kind: str, item: dict[str, Any], root: Path | None = None
) -> dict[str, Any]:
    """按显式 id 写入/覆盖某项（用于覆盖只读内置项，如 skills）。"""
    scope = item.get("scope") or "global"
    stored = {**item, "scope": scope, "updatedAt": now_iso()}
    items = [
        i for i in list_items(kind, scope, root) if i.get("id") != stored.get("id")
    ]
    items.append(stored)
    _write_items(_items_path(kind, scope, root), items)
    return stored


def delete_item(kind: str, item_id: str, scope: str, root: Path | None = None) -> None:
    items = list_items(kind, scope, root)
    remaining = [item for item in items if item.get("id") != item_id]
    if len(remaining) == len(items):
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": item_id})
    _write_items(_items_path(kind, scope, root), remaining)


def get_item(
    kind: str, item_id: str, scope: str, root: Path | None = None
) -> dict[str, Any] | None:
    for item in list_items(kind, scope, root):
        if item.get("id") == item_id:
            return item
    return None
