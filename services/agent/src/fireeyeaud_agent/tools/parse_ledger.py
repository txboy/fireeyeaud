"""parse_ledger：把原始表行解析为标准化凭证（设计 §10.1）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..store.duckdb import Database, quote_ident

_FIELDS = ["voucherNo", "date", "summary", "debit", "credit", "subject"]
_ALIASES: dict[str, list[str]] = {
    "voucherNo": ["凭证号", "凭证编号", "凭证字号"],
    "date": ["日期", "记账日期", "业务日期"],
    "summary": ["摘要", "摘要说明", "业务摘要"],
    "debit": ["借方", "借方金额", "借方发生额"],
    "credit": ["贷方", "贷方金额", "贷方发生额"],
    "subject": ["科目", "科目编码", "会计科目", "科目代码"],
}


def parse_ledger(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    table = params["table"]
    mapping: dict[str, str] = params.get("mapping") or {}

    db = Database(Path(root) / ".fireeye" / "workspace.duckdb")
    try:
        if not db.table_exists(table):
            return {"vouchers": [], "warnings": [f"table not found: {table}"]}
        columns = [
            d[0]
            for d in db.query(f"SELECT * FROM {quote_ident(table)} LIMIT 0").description
        ]
        warnings: list[str] = []
        resolved: dict[str, str | None] = {}
        for field in _FIELDS:
            col = mapping.get(field)
            if col is None:
                for alias in _ALIASES[field]:
                    if alias in columns:
                        col = alias
                        break
            if col is None or col not in columns:
                warnings.append(f"missing column for '{field}'")
                resolved[field] = None
            else:
                resolved[field] = col

        select = ["__row_id AS __row_id"] + [
            f"{quote_ident(resolved[f])} AS {f}" if resolved[f] else f"'' AS {f}"
            for f in _FIELDS
        ]
        rows = db.query(
            f"SELECT {', '.join(select)} FROM {quote_ident(table)}"
        ).fetchall()
    finally:
        db.close()

    vouchers = []
    for row in rows:
        record = dict(zip(["__row_id", *_FIELDS], row))
        vouchers.append(
            {
                "rowRef": str(record["__row_id"]),
                "voucherNo": str(record["voucherNo"] or ""),
                "date": str(record["date"] or ""),
                "summary": str(record["summary"] or ""),
                "debit": str(record["debit"] or ""),
                "credit": str(record["credit"] or ""),
                "subject": str(record["subject"] or ""),
            }
        )
    return {"vouchers": vouchers, "warnings": warnings}
