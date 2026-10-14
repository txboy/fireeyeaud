"""Access 文件解析回退（纯 Python，无 ODBC / ACE / JVM 依赖）。

当 ``sqlalchemy-access``（ODBC）不可用时，用 ``access-parser`` 读取
``.mdb`` / ``.accdb`` 的表与数据，物化到进程内内存 SQLite，
供 ``db_engine`` 复用只读查询与反射链路。

- 只读、仅表（不读保存的查询 / 关系 / 加密）。
- 按 (path, mtime_ns, size) 缓存；文件上限 1G。
"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Any

MAX_FILE_BYTES = 1024 * 1024 * 1024  # 1G
_CACHE_LIMIT = 4

_lock = threading.Lock()
_cache: dict[tuple, sqlite3.Connection] = {}
_cache_order: list[tuple] = []


def _cache_key(path: Path) -> tuple:
    st = path.stat()
    return (str(path.resolve()), st.st_mtime_ns, st.st_size)


def _quote(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def _to_sqlite_type(values: list) -> str:
    seen = [v for v in values if v is not None]
    if not seen:
        return "TEXT"
    if all(isinstance(v, bool) for v in seen):
        return "INTEGER"
    if all(isinstance(v, int) and not isinstance(v, bool) for v in seen):
        return "INTEGER"
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in seen):
        return "REAL"
    if all(isinstance(v, (bytes, bytearray)) for v in seen):
        return "BLOB"
    return "TEXT"


def _coerce(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float, str, bytes, bytearray)):
        return value
    # date / datetime / Decimal / UUID 等 → 文本（只读展示足够）
    return str(value)


def _load(path: Path) -> sqlite3.Connection:
    from access_parser import AccessParser

    parser = AccessParser(str(path))
    con = sqlite3.connect(":memory:", check_same_thread=False)
    for table in list(parser.catalog):
        data = parser.parse_table(table)
        if not data:
            continue  # 无数据 / 无列信息，跳过
        cols = list(data.keys())
        col_types = [_to_sqlite_type(data[c]) for c in cols]
        col_defs = ", ".join(
            f"{_quote(c)} {t}" for c, t in zip(cols, col_types)
        )
        con.execute(f"CREATE TABLE {_quote(table)} ({col_defs})")
        ncols = len(cols)
        nrows = max((len(data[c]) for c in cols), default=0)
        if nrows:
            placeholders = ", ".join("?" * ncols)
            rows = [
                tuple(
                    _coerce(data[c][i]) if i < len(data[c]) else None
                    for c in cols
                )
                for i in range(nrows)
            ]
            con.executemany(
                f"INSERT INTO {_quote(table)} VALUES ({placeholders})", rows
            )
    con.commit()
    return con


def _get(path) -> sqlite3.Connection:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(str(path))
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("access file exceeds 1G limit")
    key = _cache_key(path)
    with _lock:
        if key in _cache:
            return _cache[key]
    con = _load(path)
    with _lock:
        _cache[key] = con
        _cache_order.append(key)
        while len(_cache_order) > _CACHE_LIMIT:
            old = _cache_order.pop(0)
            if old in _cache:
                _cache.pop(old).close()
    return con
