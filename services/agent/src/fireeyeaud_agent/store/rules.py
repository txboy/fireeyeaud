"""审计规则库：内置（只读）+ 项目自定义（`rules.jsonl` 事件流，设计 §14.12）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..util import now_iso
from .jsonl import append_event, read_events
from .project import next_counter

BUILTIN_RULES: list[dict[str, Any]] = [
    {
        "id": "tie_check",
        "scope": "builtin",
        "type": "sql",
        "detector": "tie_check",
        "nameKey": "builtinRules.tie_check",
        "descriptionKey": "builtinRules.tie_checkDesc",
        "severity": "high",
        "enabled": True,
        "builtin": True,
    },
    {
        "id": "related_party_undisclosed",
        "scope": "builtin",
        "type": "prompt",
        "nameKey": "builtinRules.relatedParty",
        "descriptionKey": "builtinRules.relatedPartyDesc",
        "definition": "检查关联方交易是否充分披露、是否有对价说明；发现疑似未披露时报告疑点。",
        "severity": "high",
        "enabled": True,
        "builtin": True,
    },
]


def rules_path(root: Path) -> Path:
    return Path(root) / ".fireeye" / "rules.jsonl"


def fold_rules(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    builtin: dict[str, dict[str, Any]] = {r["id"]: dict(r) for r in BUILTIN_RULES}
    custom: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    for event in events:
        rid = event.get("id")
        kind = event.get("event")
        if not rid:
            continue
        if rid in builtin:
            if kind == "enabled_changed":
                builtin[rid]["enabled"] = bool(event.get("enabled"))
            elif kind == "severity_changed":
                builtin[rid]["severity"] = event.get(
                    "severity", builtin[rid]["severity"]
                )
            continue
        if kind == "created":
            custom[rid] = {
                "id": rid,
                "scope": "custom",
                "type": event.get("type", "sql"),
                "name": event.get("name"),
                "definition": event.get("definition", ""),
                "severity": event.get("severity", "medium"),
                "params": event.get("params", {}),
                "enabled": bool(event.get("enabled", True)),
                "builtin": False,
                "ts": event.get("ts"),
            }
            order.append(rid)
        elif rid in custom:
            if kind == "updated":
                for key in ("name", "definition", "severity", "params", "type"):
                    if key in event:
                        custom[rid][key] = event[key]
            elif kind == "enabled_changed":
                custom[rid]["enabled"] = bool(event.get("enabled"))
            elif kind == "deleted":
                custom[rid]["_deleted"] = True

    result = list(builtin.values())
    result += [custom[rid] for rid in order if not custom[rid].get("_deleted")]
    return result


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
        "scope": "custom",
        "type": data.get("type", "sql"),
        "name": data.get("name"),
        "definition": data.get("definition", ""),
        "severity": data.get("severity", "medium"),
        "params": data.get("params", {}),
        "enabled": bool(data.get("enabled", True)),
        "ts": now_iso(),
    }
    append_event(rules_path(root), event)
    return get_rule(root, rule_id)


def update_rule(root: Path, rule_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    if get_rule(root, rule_id) is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": rule_id})
    event: dict[str, Any] = {"event": "updated", "id": rule_id, "ts": now_iso()}
    for key in ("name", "definition", "severity", "params", "type"):
        if key in patch and patch[key] is not None:
            event[key] = patch[key]
    append_event(rules_path(root), event)
    return get_rule(root, rule_id)


def set_enabled(root: Path, rule_id: str, enabled: bool) -> dict[str, Any]:
    if get_rule(root, rule_id) is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": rule_id})
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
    rule = get_rule(root, rule_id)
    if rule is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": rule_id})
    if rule.get("builtin"):
        raise ApiError(
            "E_RULE_INVALID", 400, "error.ruleInvalid", {"reason": "builtin"}
        )
    append_event(rules_path(root), {"event": "deleted", "id": rule_id, "ts": now_iso()})
