"""技能包存储（用户自定义 CRUD，prompt 注入系统提示词）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import store

KIND = "skills"


def list_skills(root: Path | None = None) -> list[dict[str, Any]]:
    return store.load_effective(KIND, root)


def get_skill(
    skill_id: str, scope: str, root: Path | None = None
) -> dict[str, Any] | None:
    for skill in list_skills(root):
        if skill.get("id") == skill_id:
            return skill
    return None


def create_skill(data: dict[str, Any], root: Path | None = None) -> dict[str, Any]:
    return store.create_item(KIND, data, root)


def update_skill(
    skill_id: str, scope: str, patch: dict[str, Any], root: Path | None = None
) -> dict[str, Any]:
    return store.update_item(KIND, skill_id, scope, patch, root)


def delete_skill(skill_id: str, scope: str, root: Path | None = None) -> None:
    store.delete_item(KIND, skill_id, scope, root)


def enabled_prompts(root: Path | None = None) -> list[dict[str, Any]]:
    return [s for s in list_skills(root) if s.get("enabled") and s.get("prompt")]


def prompts_for(
    root: Path | None = None, skill_ids: list[str] | None = None
) -> list[dict[str, Any]]:
    """会话生效技能提示词 = 默认（enabled ∧ isDefault）∪ 勾选（enabled ∧ id∈skill_ids）。"""
    wanted = {str(i) for i in (skill_ids or [])}
    out: list[dict[str, Any]] = []
    for s in list_skills(root):
        if not (s.get("enabled") and s.get("prompt")):
            continue
        if s.get("isDefault") or str(s.get("id")) in wanted:
            out.append(s)
    return out
