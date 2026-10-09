"""check_tie：勾稽/平衡校验（设计 §10.1）。"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from typing import Any

from .aggregate_subject import aggregate_subject


def _fmt(value: Decimal) -> str:
    return f"{value:.2f}"


def check_tie(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    table = params["table"]
    rules = params.get("rules") or []
    agg = aggregate_subject(
        root,
        {
            "table": table,
            "subjectCol": params.get("subjectCol", "科目"),
            "debitCol": params.get("debitCol", "借方"),
            "creditCol": params.get("creditCol", "贷方"),
        },
    )
    subjects = agg["subjects"]
    balances = {s["code"]: Decimal(s["balance"]) for s in subjects}

    diffs: list[dict[str, str]] = []
    if rules:
        for rule in rules:
            code = str(rule["subject"])
            expected = Decimal(str(rule["expected"]))
            actual = balances.get(code, Decimal(0))
            delta = expected - actual
            if delta != 0:
                diffs.append(
                    {
                        "subject": code,
                        "expected": _fmt(expected),
                        "actual": _fmt(actual),
                        "delta": _fmt(delta),
                    }
                )
    else:
        total_debit = sum((Decimal(s["debit"]) for s in subjects), Decimal(0))
        total_credit = sum((Decimal(s["credit"]) for s in subjects), Decimal(0))
        delta = total_debit - total_credit
        if delta != 0:
            diffs.append(
                {
                    "subject": "(total)",
                    "expected": _fmt(total_credit),
                    "actual": _fmt(total_debit),
                    "delta": _fmt(delta),
                }
            )

    return {"balanced": not diffs, "diffs": diffs}
