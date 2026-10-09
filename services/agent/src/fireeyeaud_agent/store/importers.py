"""Excel/CSV 读取（全字符串，保留原值；设计 §14.3）。"""

from __future__ import annotations

from pathlib import Path

import pandas as pd


def read_table(path: Path) -> tuple[list[str], list[list[str]]]:
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xlsm"):
        frame = pd.read_excel(path, dtype=str, engine="openpyxl").fillna("")
    elif suffix in (".csv", ".txt"):
        try:
            frame = pd.read_csv(
                path, dtype=str, keep_default_na=False, encoding="utf-8-sig"
            )
        except UnicodeDecodeError:
            frame = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="gbk")
    else:
        raise ValueError(f"unsupported file type: {suffix}")
    columns = [str(c) for c in frame.columns]
    rows = [[str(v) for v in row] for row in frame.itertuples(index=False, name=None)]
    return columns, rows
