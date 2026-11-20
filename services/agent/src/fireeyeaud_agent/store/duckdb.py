"""DuckDB 连接封装（单写连接；原始表 src_*）。"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Iterable, Sequence

import duckdb

# 工作区数据已经导入 DuckDB；运行期不需要读任何外部文件。
# 注意：同一进程内同一数据库文件的所有连接必须使用完全相同的 config，
# 否则 DuckDB 会报 "different configuration"。
DUCKDB_CONFIG = {
    "enable_external_access": "false",
    # 禁止 SQL 或后续连接把安全选项改回去。
    "lock_configuration": "true",
}


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


class Database:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._con = duckdb.connect(str(path), config=dict(DUCKDB_CONFIG))

    def execute(self, sql: str, params: Sequence[Any] | None = None):
        return self._con.execute(sql, list(params or []))

    def query(self, sql: str, params: Sequence[Any] | None = None):
        return self._con.execute(sql, list(params or []))

    def fetchall(
        self,
        sql: str,
        params: Sequence[Any] | None = None,
        *,
        timeout_seconds: float | None = None,
    ):
        """执行查询并在超时时调用 DuckDB interrupt。

        超时覆盖 execute + fetchall 整段，而不只是 execute 调用。
        """
        timer = None
        if timeout_seconds and timeout_seconds > 0:
            timer = threading.Timer(float(timeout_seconds), self._con.interrupt)
            timer.daemon = True
            timer.start()
        try:
            cursor = self._con.execute(sql, list(params or []))
            return cursor.fetchall(), [str(d[0]) for d in (cursor.description or [])]
        finally:
            if timer is not None:
                timer.cancel()

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
