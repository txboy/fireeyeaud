"""规则引擎：运行用户自定义 SQL 规则（试跑与 `run_rule` 工具共用）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..tools.sql_query import sql_query
from .rules import get_rule

_PREVIEW_LIMIT = 200


def run_rule(
    root: Path,
    rule_id: str,
    *,
    sql: str | None = None,
    source_id: str | None = None,
    allowed_connection_ids: list[str] | None = None,
) -> dict[str, Any]:
    """执行一条规则。

    - `sql` 为空时用规则保存的 SQL（试跑工作台可传编辑后的 SQL）。
    - `source_id is None` 时回退到规则的默认数据库；显式传 `""` 表示工作区 DuckDB。
    """
    rule = get_rule(root, rule_id)
    if rule is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": rule_id})
    effective_sql = (sql or "").strip() or rule.get("sql", "")
    source = source_id if source_id is not None else rule.get("databaseId")
    params: dict[str, Any] = {"sql": effective_sql, "limit": _PREVIEW_LIMIT}
    if source:
        params["sourceId"] = source
    if allowed_connection_ids is not None:
        params["allowedConnectionIds"] = allowed_connection_ids
    result = sql_query(root, params)
    return {"ruleId": rule_id, **result}
