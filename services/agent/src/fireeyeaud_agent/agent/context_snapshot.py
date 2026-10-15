"""会话上下文快照：记录某条用户消息实际带给模型的「勾选」资源（非默认项）。

用于在每条用户消息下方标注本次发送的可选项。默认（isDefault）项不在此列，
因为它们无需勾选即自动生效，若出现在勾选集合中也一并跳过。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

GROUP_KEYS = ("database", "knowledge", "mcp", "skills", "rules")


def _resolve(items: list[dict[str, Any]], ids: Any) -> list[dict[str, str]]:
    """把勾选的 id 解析为 {id, name}，跳过默认项与已删除项，保持勾选顺序。"""
    index = {str(i.get("id")): i for i in items if i.get("id")}
    out: list[dict[str, str]] = []
    for raw in ids or []:
        item = index.get(str(raw))
        if item is None or item.get("isDefault"):
            continue
        ident = str(item.get("id"))
        out.append({"id": ident, "name": str(item.get("name") or ident)})
    return out


def build_snapshot(
    root: Path, context: dict[str, Any] | None, model_id: str | None
) -> dict[str, Any]:
    from ..config import store as config_store
    from ..store import db as db_store
    from ..store import knowledge as kb_store
    from ..store import mcp as mcp_store
    from ..store import rules as rules_store
    from ..store import skills as skills_store

    context = context or {}

    model: dict[str, str] | None = None
    if model_id:
        models = {str(m.get("id")): m for m in config_store.load_effective("models", root)}
        found = models.get(str(model_id))
        model = {
            "id": str(model_id),
            "name": str((found or {}).get("name") or model_id),
        }

    return {
        "model": model,
        "database": _resolve(
            db_store.list_connections(root), context.get("dbConnectionIds")
        ),
        "knowledge": _resolve(
            kb_store.list_providers(root), context.get("kbProviderIds")
        ),
        "mcp": _resolve(mcp_store.list_servers(root), context.get("mcpServerIds")),
        "skills": _resolve(skills_store.list_skills(root), context.get("skillIds")),
        "rules": _resolve(rules_store.list_rules(root), context.get("ruleIds")),
    }
