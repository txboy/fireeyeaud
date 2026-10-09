"""DuckDB 连接封装（单写连接；原始表 src_*）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable, Sequence

import duckdb


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


class Database:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._con = duckdb.connect(str(path))

    def execute(self, sql: str, params: Sequence[Any] | None = None):
        return self._con.execute(sql, list(params or []))

    def query(self, sql: str, params: Sequence[Any] | None = None):
        return self._con.execute(sql, list(params or []))

    def table_exists(self, table: str) -> bool:
        rows = self._con.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_name = ?", [table]
        ).fetchall()
        return bool(rows)

    def create_table_from_rows(
        self, table: str, columns: Sequence[str], rows: Iterable[Sequence[Any]]
    ) -> int:
        cols = ", ".join(f"{quote_ident(c)} VARCHAR" for c in columns)
        self._con.execute(f"CREATE OR REPLACE TABLE {quote_ident(table)} ({cols})")
        placeholders = ", ".join("?" for _ in columns)
        batch = [tuple(r) for r in rows]
        if batch:
            self._con.executemany(
                f"INSERT INTO {quote_ident(table)} VALUES ({placeholders})", batch
            )
        return len(batch)

    def drop_table(self, table: str) -> None:
        if self.table_exists(table):
            self._con.execute(f"DROP TABLE {quote_ident(table)}")

    def close(self) -> None:
        self._con.close()
