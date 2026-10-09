"""SQL 只读沙箱（设计 §17.3）。"""

from __future__ import annotations

import re

from ..errors import ApiError

_ALLOWED = ("select", "with", "explain", "describe")
_FORBIDDEN = re.compile(
    r"\b(attach|detach|copy|install|load|export|pragma|create|drop|alter|"
    r"insert|update|delete|truncate|call|set)\b",
    re.IGNORECASE,
)


def validate_sql(sql: str) -> str:
    text = (sql or "").strip().rstrip(";").strip()
    if not text:
        raise ApiError("E_SQL_REJECTED", 400, "error.sqlRejected", {"reason": "empty"})
    if ";" in text:
        raise ApiError(
            "E_SQL_REJECTED",
            400,
            "error.sqlRejected",
            {"reason": "multiple_statements"},
        )
    first = re.split(r"\s+", text, maxsplit=1)[0].lower()
    if first not in _ALLOWED:
        raise ApiError(
            "E_SQL_REJECTED", 400, "error.sqlRejected", {"reason": "not_readonly"}
        )
    if _FORBIDDEN.search(text):
        raise ApiError(
            "E_SQL_REJECTED", 400, "error.sqlRejected", {"reason": "forbidden_keyword"}
        )
    return text
