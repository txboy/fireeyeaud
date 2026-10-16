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


def effective_ids(
    root: Path | None = None, skill_ids: list[str] | None = None
) -> set[str]:
    """生效技能 id 集合 = 默认（enabled ∧ isDefault）∪ 勾选（enabled ∧ id∈skillIds）。

    与 `prompts_for` 同一套语义（enabled ∧ 有正文），供 `load_skill` 的 allowlist 使用。
    """
    wanted = {str(i) for i in (skill_ids or [])}
    ids: set[str] = set()
    for s in list_skills(root):
        if not (s.get("enabled") and s.get("prompt")):
            continue
        sid = str(s.get("id"))
        if s.get("isDefault") or sid in wanted:
            ids.add(sid)
    return ids


_DESCRIPTION_MAX = 120


def _derived_description(skill: dict[str, Any]) -> str:
    """广告用的一句话描述：显式 `description` → prompt 首行 → name（截断）。"""
    explicit = str(skill.get("description") or "").strip()
    if explicit:
        return explicit[:_DESCRIPTION_MAX]
    prompt = str(skill.get("prompt") or "").strip()
    first_line = next((ln.strip() for ln in prompt.splitlines() if ln.strip()), "")
    return (first_line or str(skill.get("name") or "").strip())[:_DESCRIPTION_MAX]


def catalog_for(
    root: Path | None = None, skill_ids: list[str] | None = None
) -> list[dict[str, Any]]:
    """生效技能的元数据（id/name/description/whenToUse），剔除 `prompt` 正文。

    `eager=true` 的技能不在此列：它们仍全量注入正文（§4.5 逃生口）。
    """
    wanted = {str(i) for i in (skill_ids or [])}
    out: list[dict[str, Any]] = []
    for s in list_skills(root):
        if not (s.get("enabled") and s.get("prompt")):
            continue
        if not (s.get("isDefault") or str(s.get("id")) in wanted):
            continue
        if s.get("eager"):
            continue
        entry: dict[str, Any] = {
            "id": str(s.get("id")),
            "name": str(s.get("name") or ""),
            "description": _derived_description(s),
        }
        when = str(s.get("whenToUse") or "").strip()
        if when:
            entry["whenToUse"] = when
        out.append(entry)
    return out


def get_prompt(root: Path | None, skill_id: str) -> dict[str, Any] | None:
    """按 id 取技能正文（供 `load_skill`）；未启用 / 不存在返回 None。"""
    target = str(skill_id)
    for s in list_skills(root):
        if str(s.get("id")) == target and s.get("enabled"):
            return {
                "id": target,
                "name": str(s.get("name") or ""),
                "prompt": str(s.get("prompt") or ""),
            }
    return None
