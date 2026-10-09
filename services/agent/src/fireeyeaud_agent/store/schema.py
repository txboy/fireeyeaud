"""列类型推断（采样；仅用于 schema.json 标注，落库仍为 VARCHAR）。"""

from __future__ import annotations

import re

_NUMERIC = re.compile(r"^-?\d+(\.\d+)?$")
_DECIMAL = re.compile(r"^-?\d+\.\d+$")
_DATE = re.compile(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}")


def infer_type(sample: str) -> str:
    value = (sample or "").strip()
    if not value:
        return "string"
    if _DATE.match(value):
        return "date"
    if _DECIMAL.match(value):
        return "decimal"
    return "string"


def infer_column(column: str, values: list[str]) -> dict[str, str]:
    samples = [v for v in values if v and v.strip()][:50]
    kind = "string"
    if samples:
        if all(_NUMERIC.match(v) for v in samples) and any("." in v for v in samples):
            kind = "decimal"
        elif all(_DATE.match(v) for v in samples):
            kind = "date"
    first = samples[0] if samples else ""
    return {"name": column, "type": kind, "sample": first}
