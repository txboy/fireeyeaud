"""Access 文件解析回退（纯 Python，无 ODBC / ACE / JVM 依赖）。

当 ``sqlalchemy-access``（ODBC）不可用时，用 ``access-parser`` 读取
``.mdb`` / ``.accdb`` 的表与数据，物化到进程内内存 SQLite，
供 ``db_engine`` 复用只读查询与反射链路。

- 只读、仅表（不读保存的查询 / 关系 / 加密）。
- 按 (path, mtime_ns, size) 复用连接；文件上限 1G。
- 同一连接的查询串行执行（sqlite3 连接非线程安全）。
"""

from __future__ import annotations

import contextlib
import sqlite3
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any, Iterator

MAX_FILE_BYTES = 1024 * 1024 * 1024  # 1G
_CACHE_LIMIT = 4


class _Entry:
    __slots__ = ("con", "lock", "refs")

    def __init__(self, con: sqlite3.Connection) -> None:
        self.con = con
        self.lock = threading.Lock()
        self.refs = 0


_lock = threading.Lock()
_cache: "OrderedDict[tuple, _Entry]" = OrderedDict()


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
    try:
        for table in list(parser.catalog):
            if str(table).startswith("MSys"):
                continue  # 跳过 Access 系统表
            data = parser.parse_table(table)
            if not data:
                continue  # 无数据 / 无列信息，跳过
            cols = list(data.keys())
            col_types = [_to_sqlite_type(data[c]) for c in cols]
            col_defs = ", ".join(f"{_quote(c)} {t}" for c, t in zip(cols, col_types))
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
    except Exception:
        con.close()
        raise
    return con


def _evict_locked() -> None:
    while len(_cache) > _CACHE_LIMIT:
        key, entry = next(iter(_cache.items()))
        if entry.refs > 0:
            return
        _cache.pop(key)
        entry.con.close()


@contextlib.contextmanager
def open_db(path) -> Iterator[sqlite3.Connection]:
    """打开(或复用)进程内 SQLite 连接；同一连接上的查询串行执行。"""
    path = Path(path)
    try:
        st = path.stat()
    except FileNotFoundError:
        raise FileNotFoundError(str(path)) from None
    if st.st_size > MAX_FILE_BYTES:
        raise ValueError("access file exceeds 1G limit")
    key = (str(path.resolve()), st.st_mtime_ns, st.st_size)
    with _lock:
        entry = _cache.get(key)
        if entry is None:
            entry = _Entry(_load(path))  # 持锁加载，避免重复解析
            _cache[key] = entry
        else:
            _cache.move_to_end(key)
        entry.refs += 1
    try:
        with entry.lock:
            yield entry.con
    finally:
        with _lock:
            entry.refs -= 1
            _evict_locked()


def reset_cache() -> None:
    """仅供测试：清空缓存并关闭所有连接。"""
    with _lock:
        for entry in _cache.values():
            entry.con.close()
        _cache.clear()
