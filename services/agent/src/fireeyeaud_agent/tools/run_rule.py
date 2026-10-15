"""run_rule：运行一条已保存的自定义 SQL 规则（默认数据库，可覆盖）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..errors import ApiError


def run_rule(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    from ..store.rule_engine import run_rule as _run_rule

    rule_id = str(params.get("ruleId") or "").strip()
    if not rule_id:
        raise ApiError("E_RULE_INVALID", 400, "error.ruleInvalid", {"reason": "ruleId"})
    # 会话上下文：仅允许默认 ∪ 勾选的规则（None 表示不限制）。
    allowed_rules = params.get("allowedRuleIds")
    if allowed_rules is not None and rule_id not in {str(i) for i in allowed_rules}:
        raise ApiError(
            "E_RULE_UNAUTHORIZED", 403, "error.ruleUnauthorized", {"id": rule_id}
        )
    source_id = params.get("sourceId") or None
    allowed = params.get("allowedConnectionIds")
    return _run_rule(root, rule_id, source_id=source_id, allowed_connection_ids=allowed)
