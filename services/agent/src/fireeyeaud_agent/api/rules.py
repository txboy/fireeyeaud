"""规则库路由（用户自定义 SQL 规则）。"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..errors import ApiError
from ..store import rules as rules_store
from ..store.rule_engine import run_rule
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["rules"], dependencies=[Depends(require_token)])


class RuleBody(BaseModel):
    name: str
    description: str = ""
    sql: str = ""
    databaseId: str | None = None
    enabled: bool = True


class RulePatch(BaseModel):
    name: str | None = None
    description: str | None = None
    sql: str | None = None
    databaseId: str | None = None
    enabled: bool | None = None


class RunBody(BaseModel):
    # 试跑工作台可传编辑后的 SQL；缺省用规则保存的 SQL。
    sql: str | None = None
    # 显式传 "" 表示工作区；缺省回退规则的默认数据库。
    sourceId: str | None = None


def _root() -> Path:
    if workspace_manager.root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    return workspace_manager.root


@router.get("/rules")
def list_rules() -> dict:
    if workspace_manager.root is None:
        return {"items": [], "nextCursor": None}
    return {"items": rules_store.list_rules(workspace_manager.root), "nextCursor": None}


@router.post("/rules")
def create_rule(body: RuleBody) -> dict:
    return rules_store.create_rule(_root(), body.model_dump())


@router.patch("/rules/{rule_id}")
def update_rule(rule_id: str, body: RulePatch) -> dict:
    patch = body.model_dump(exclude_unset=True)
    if "enabled" in patch:
        rules_store.set_enabled(_root(), rule_id, bool(patch["enabled"]))
        patch.pop("enabled")
    if patch:
        return rules_store.update_rule(_root(), rule_id, patch)
    return rules_store.get_rule(_root(), rule_id)


@router.post("/rules/{rule_id}/run")
def run_single(rule_id: str, body: RunBody | None = None) -> dict:
    payload = body or RunBody()
    return run_rule(_root(), rule_id, sql=payload.sql, source_id=payload.sourceId)


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: str) -> dict:
    rules_store.delete_rule(_root(), rule_id)
    return {"ok": True}
