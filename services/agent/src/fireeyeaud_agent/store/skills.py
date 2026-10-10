"""技能包存储（设计 §14 / 决策：内置只读 + 自定义 CRUD，prompt 注入系统提示词）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import store

KIND = "skills"

_BUILTIN: list[dict[str, Any]] = [
    {
        "id": "sk_builtin_going_concern",
        "name": "持续经营评估",
        "prompt": "评估持续经营假设：关注现金流、到期债务与重大不确定事项。",
        "toolIds": ["sql_query", "aggregate_subject"],
        "enabled": False,
    },
    {
        "id": "sk_builtin_related_party",
        "name": "关联方交易",
        "prompt": "识别关联方及异常定价、非经常性资金往来。",
        "toolIds": ["sql_query"],
        "enabled": False,
    },
]


def _overlay_builtin(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {i["id"]: i for i in items}
    out: list[dict[str, Any]] = []
    for base in _BUILTIN:
        stored = by_id.pop(base["id"], {})
        merged = {**base, **stored, "builtin": True, "scope": "builtin"}
        out.append(merged)
    out.extend(by_id.values())
    return out


def list_skills(root: Path | None = None) -> list[dict[str, Any]]:
    return _overlay_builtin(store.load_effective(KIND, root))


def get_skill(
    skill_id: str, scope: str, root: Path | None = None
) -> dict[str, Any] | None:
    for skill in list_skills(root):
        if skill.get("id") == skill_id:
            return skill
    return None


def create_skill(data: dict[str, Any], root: Path | None = None) -> dict[str, Any]:
    return store.create_item(KIND, {**data, "builtin": False}, root)


def update_skill(
    skill_id: str, scope: str, patch: dict[str, Any], root: Path | None = None
) -> dict[str, Any]:
    from ..errors import ApiError

    existing = store.get_item(KIND, skill_id, scope, root)
    if existing is not None:
        return store.update_item(KIND, skill_id, scope, patch, root)
    base = next((b for b in _BUILTIN if b["id"] == skill_id), None)
    if base is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": skill_id})
    payload = {
        **base,
        **{k: v for k, v in patch.items() if v is not None},
        "id": skill_id,
        "scope": scope,
        "builtin": True,
    }
    return store.put_item(KIND, payload, root)


def delete_skill(skill_id: str, scope: str, root: Path | None = None) -> None:
    store.delete_item(KIND, skill_id, scope, root)


def enabled_prompts(root: Path | None = None) -> list[dict[str, Any]]:
    return [s for s in list_skills(root) if s.get("enabled") and s.get("prompt")]
