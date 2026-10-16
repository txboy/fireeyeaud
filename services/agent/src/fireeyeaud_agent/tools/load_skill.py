"""load_skill：按 id 取会话生效技能的完整正文（Phase 9 · 技能按需加载）。

技能正文不再全量注入 system prompt，改由本工具按需返回；`allowedSkillIds`
（默认 ∪ 勾选 ∧ enabled）由 `registry._context_wrapper` 注入，越权返回 not_allowed。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


def load_skill(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    from ..store.skills import get_prompt

    skill_id = str(params.get("skillId") or "").strip()
    if not skill_id:
        return {"error": "not_allowed"}
    skill = get_prompt(root, skill_id)
    if skill is None:
        return {"error": "not_allowed"}
    allowed = params.get("allowedSkillIds")
    if allowed is not None and skill["id"] not in {str(i) for i in allowed}:
        return {"error": "not_allowed"}
    return {"id": skill["id"], "name": skill["name"], "prompt": skill["prompt"]}
