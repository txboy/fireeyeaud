"""技能包路由（设计 §14.8）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..errors import ApiError
from ..store import skills
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["skills"], dependencies=[Depends(require_token)])


class SkillBody(BaseModel):
    name: str
    prompt: str
    toolIds: list[str] | None = None
    params: dict | None = None
    enabled: bool = False
    scope: str = "global"


class SkillPatch(BaseModel):
    name: str | None = None
    prompt: str | None = None
    toolIds: list[str] | None = None
    params: dict | None = None
    enabled: bool | None = None


@router.get("/skills")
def list_skills() -> dict:
    return {"items": skills.list_skills(workspace_manager.root), "nextCursor": None}


@router.post("/skills")
def create_skill(body: SkillBody) -> dict:
    return skills.create_skill(body.model_dump(), workspace_manager.root)


@router.patch("/skills/{skill_id}")
def update_skill(
    skill_id: str, body: SkillPatch, scope: str = Query(default="global")
) -> dict:
    return skills.update_skill(
        skill_id, scope, body.model_dump(exclude_unset=True), workspace_manager.root
    )


@router.delete("/skills/{skill_id}")
def delete_skill(skill_id: str, scope: str = Query(default="global")) -> dict:
    if skill_id.startswith("sk_builtin_"):
        raise ApiError("E_SKILL_BUILTIN", 400, "error.skillBuiltin", {"id": skill_id})
    skills.delete_skill(skill_id, scope, workspace_manager.root)
    return {"ok": True}
