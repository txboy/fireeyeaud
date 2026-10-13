"""审计规则库：用户自定义 SQL 规则（`rules.jsonl` 事件流）。

一条规则 = 名称 + 描述 + 只读 SQL（+ 可选默认数据库连接）。
模型通过系统提示词感知这些 SQL，并用 `run_rule` 工具运行。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..util import now_iso
from .jsonl import append_event, read_events
from .project import next_counter

_FIELDS = ("name", "description", "sql", "databaseId")


def rules_path(root: Path) -> Path:
    return Path(root) / ".fireeye" / "rules.jsonl"


def fold_rules(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    custom: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    for event in events:
        rid = event.get("id")
        kind = event.get("event")
        if not rid:
            continue
        if kind == "created":
            custom[rid] = {
                "id": rid,
                "name": event.get("name") or "",
                "description": event.get("description", ""),
                "sql": event.get("sql", ""),
                "databaseId": event.get("databaseId"),
                "enabled": bool(event.get("enabled", True)),
                "ts": event.get("ts"),
            }
            order.append(rid)
        elif rid in custom:
            if kind == "updated":
                for key in _FIELDS:
                    if key in event:
                        custom[rid][key] = event[key]
            elif kind == "enabled_changed":
                custom[rid]["enabled"] = bool(event.get("enabled"))
            elif kind == "deleted":
                custom[rid]["_deleted"] = True

    return [custom[rid] for rid in order if not custom[rid].get("_deleted")]


def list_rules(root: Path) -> list[dict[str, Any]]:
    return fold_rules(read_events(rules_path(root)))


def get_rule(root: Path, rule_id: str) -> dict[str, Any] | None:
    for rule in list_rules(root):
        if rule.get("id") == rule_id:
            return rule
    return None


def create_rule(root: Path, data: dict[str, Any]) -> dict[str, Any]:
    root = Path(root)
    fe = root / ".fireeye"
    seq_id = next_counter(fe, "rule", root)
    rule_id = f"R-{seq_id:04d}"
    event = {
        "event": "created",
        "id": rule_id,
        "name": data.get("name") or "",
        "description": data.get("description", ""),
        "sql": data.get("sql", ""),
        "databaseId": data.get("databaseId"),
        "enabled": bool(data.get("enabled", True)),
        "ts": now_iso(),
    }
    append_event(rules_path(root), event)
    return get_rule(root, rule_id)


def _require(root: Path, rule_id: str) -> dict[str, Any]:
    rule = get_rule(root, rule_id)
    if rule is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": rule_id})
    return rule


def update_rule(root: Path, rule_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    _require(root, rule_id)
    event: dict[str, Any] = {"event": "updated", "id": rule_id, "ts": now_iso()}
    for key in _FIELDS:
        if key not in patch:
            continue
        # databaseId 允许置空（清除默认库）；其余字段忽略 None。
        if key == "databaseId" or patch[key] is not None:
            event[key] = patch[key]
    append_event(rules_path(root), event)
    return get_rule(root, rule_id)


def set_enabled(root: Path, rule_id: str, enabled: bool) -> dict[str, Any]:
    _require(root, rule_id)
    append_event(
        rules_path(root),
        {
            "event": "enabled_changed",
            "id": rule_id,
            "enabled": bool(enabled),
            "ts": now_iso(),
        },
    )
    return get_rule(root, rule_id)


def delete_rule(root: Path, rule_id: str) -> None:
    _require(root, rule_id)
    append_event(rules_path(root), {"event": "deleted", "id": rule_id, "ts": now_iso()})
