"""规则引擎：试跑预览与批量产出疑点（设计 §14.12）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..tools.check_tie import check_tie
from ..tools.sql_query import sql_query
from .findings import create_finding
from .index import load_schema
from .rules import get_rule, list_rules

_PREVIEW_LIMIT = 50
_CANDIDATE_COLUMNS = {"科目", "借方", "贷方"}


def _schema_path(root: Path) -> Path:
    return Path(root) / ".fireeye" / "index" / "schema.json"


def _find_balance_table(root: Path) -> str | None:
    schema = load_schema(_schema_path(root))
    for entry in schema:
        cols = {c.get("name") for c in entry.get("columns", [])}
        if _CANDIDATE_COLUMNS <= cols:
            return entry.get("table")
    return None


def _run_detector(root: Path, detector: str) -> dict[str, Any]:
    if detector == "tie_check":
        table = _find_balance_table(root)
        if table is None:
            return {
                "ruleId": detector,
                "kind": "detector",
                "balanced": True,
                "diffs": [],
            }
        result = check_tie(root, {"table": table})
        return {"ruleId": detector, "kind": "detector", "table": table, **result}
    raise ApiError("E_RULE_INVALID", 400, "error.ruleInvalid", {"detector": detector})


def run_rule(root: Path, rule_id: str) -> dict[str, Any]:
    rule = get_rule(root, rule_id)
    if rule is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": rule_id})
    if rule.get("detector"):
        return _run_detector(root, rule["detector"])
    if rule.get("type") != "sql":
        raise ApiError(
            "E_RULE_NOT_RUNNABLE", 400, "error.ruleNotRunnable", {"id": rule_id}
        )
    result = sql_query(
        root, {"sql": rule.get("definition", ""), "limit": _PREVIEW_LIMIT}
    )
    return {"ruleId": rule_id, "kind": "sql", **result}


def run_all_rules(root: Path) -> dict[str, Any]:
    created: list[str] = []
    for rule in list_rules(root):
        if not rule.get("enabled"):
            continue
        rule_id = rule["id"]
        if rule.get("detector") == "tie_check":
            table = _find_balance_table(root)
            if table is None:
                continue
            result = check_tie(root, {"table": table})
            for diff in result["diffs"]:
                rec = create_finding(
                    root,
                    title=None,
                    description=None,
                    severity=rule["severity"],
                    dataRefs=[
                        {"sourceId": "", "table": table, "rowRef": diff["subject"]}
                    ],
                    sessionId="",
                    origin="rule",
                    ruleKey=rule_id,
                    params={**diff, "table": table},
                )
                created.append(rec["id"])
        elif rule.get("type") == "sql" and not rule.get("builtin"):
            result = sql_query(
                root, {"sql": rule.get("definition", ""), "limit": _PREVIEW_LIMIT}
            )
            for row in result.get("rows", []):
                rec = create_finding(
                    root,
                    title=None,
                    description=None,
                    severity=rule["severity"],
                    dataRefs=[],
                    sessionId="",
                    origin="rule",
                    ruleKey=rule_id,
                    params={"row": row},
                )
                created.append(rec["id"])
    return {"created": created, "count": len(created)}
