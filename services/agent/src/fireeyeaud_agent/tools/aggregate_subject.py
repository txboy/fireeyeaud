"""aggregate_subject：按科目汇总借贷与余额（设计 §10.1）。"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from typing import Any

from ..store.duckdb import Database, quote_ident


def _fmt(value: Any) -> str:
    if value is None:
        return "0.00"
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    return str(value)


def aggregate_subject(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    table = params["table"]
    subject_col = params["subjectCol"]
    debit_col = params["debitCol"]
    credit_col = params["creditCol"]
    name_col = params.get("nameCol")

    db = Database(Path(root) / ".fireeye" / "workspace.duckdb")
    try:
        if not db.table_exists(table):
            return {"subjects": []}
        cols = [f"{quote_ident(subject_col)} AS code"]
        if name_col:
            cols.append(f"{quote_ident(name_col)} AS name")
        cols.append(f"SUM(CAST({quote_ident(debit_col)} AS DECIMAL(38,2))) AS debit")
        cols.append(f"SUM(CAST({quote_ident(credit_col)} AS DECIMAL(38,2))) AS credit")
        sql = (
            f"SELECT {', '.join(cols)} FROM {quote_ident(table)} GROUP BY 1 ORDER BY 1"
        )
        rows = db.query(sql).fetchall()
    finally:
        db.close()

    subjects = []
    for row in rows:
        code = row[0]
        offset = 1
        name = code
        if name_col:
            name = row[1]
            offset = 2
        debit = row[offset]
        credit = row[offset + 1]
        balance = (debit or Decimal(0)) - (credit or Decimal(0))
        subjects.append(
            {
                "code": str(code),
                "name": str(name) if name is not None else str(code),
                "debit": _fmt(debit),
                "credit": _fmt(credit),
                "balance": _fmt(balance),
            }
        )
    return {"subjects": subjects}
