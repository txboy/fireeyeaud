"""导入编排：源文件 → DuckDB 原始表 + schema.json + files.json + 数据源注册。

设计 §7 / §14.3 / §14.14。
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Callable

from ..errors import ApiError
from ..util import now_iso
from .duckdb import Database
from .importers import read_table
from .index import load_files, save_files, upsert_schema_entry
from .project import ensure_project, next_counter, save_project
from .schema import infer_column

_SUBDIRS = ("config", "templates", "index", "artifacts")
_EXCEL_SUFFIXES = (".xlsx", ".xlsm")
Progress = Callable[[str, int, int], None]


def sanitize_table_name(name: str) -> str:
    cleaned = re.sub(r"[^\w\u4e00-\u9fff]", "_", name)
    return cleaned or "t"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _source_type(path: Path) -> str:
    return "excel" if path.suffix.lower() in _EXCEL_SUFFIXES else "csv"


def _emit(progress: Progress | None, phase: str, done: int, total: int) -> None:
    if progress is not None:
        progress(phase, done, total)


def import_source(root: Path, path: Path, *, progress: Progress | None = None) -> dict:
    root = Path(root)
    path = Path(path)
    if not path.exists() or not path.is_file():
        raise ApiError("E_PATH_INVALID", 400, "error.pathInvalid", {"path": str(path)})

    fe = root / ".fireeye"
    for sub in _SUBDIRS:
        (fe / sub).mkdir(parents=True, exist_ok=True)

    sha = _sha256(path)
    files_path = fe / "index" / "files.json"
    files = load_files(files_path)
    if any(f.get("sha256") == sha and f.get("status") == "ok" for f in files):
        raise ApiError("E_IMPORT_DUP", 409, "error.importDup", {"path": str(path)})

    _emit(progress, "parse", 0, 1)
    try:
        columns, rows = read_table(path)
    except Exception as exc:  # noqa: BLE001 - 解析失败统一转错误码
        raise ApiError(
            "E_IMPORT_PARSE",
            422,
            "error.importParse",
            {"path": str(path), "reason": str(exc)},
        ) from exc
    _emit(progress, "parse", 1, 1)

    ds_seq = next_counter(fe, "dataSource", root)
    ds_id = f"ds_{ds_seq}"
    table = f"src_ds{ds_seq}_{sanitize_table_name(path.stem)}"

    db = Database(fe / "workspace.duckdb")
    try:
        _emit(progress, "load", 0, max(len(rows), 1))
        with_rowid = [
            [str(i + 1), *[str(v) for v in row]] for i, row in enumerate(rows)
        ]
        db.create_table_from_rows(table, ["__row_id", *columns], with_rowid)
        _emit(progress, "load", len(rows), max(len(rows), 1))
    finally:
        db.close()

    _emit(progress, "index", 0, 1)
    col_values = list(map(list, zip(*rows))) if rows else [[] for _ in columns]
    upsert_schema_entry(
        fe / "index" / "schema.json",
        {
            "sourceId": ds_id,
            "table": table,
            "rowCount": len(rows),
            "headerRow": 1,
            "columns": [
                infer_column(name, values) for name, values in zip(columns, col_values)
            ],
        },
    )

    stat = path.stat()
    fingerprint = {
        "path": str(path),
        "size": stat.st_size,
        "mtime": now_iso(),
        "sha256": sha,
        "sourceId": ds_id,
        "importedAt": now_iso(),
        "status": "ok",
    }
    save_files(
        files_path, [f for f in files if f.get("path") != str(path)] + [fingerprint]
    )

    project = ensure_project(fe, root)
    project.setdefault("dataSources", []).append(
        {
            "id": ds_id,
            "type": _source_type(path),
            "path": str(path),
            "tables": [table],
            "importedAt": now_iso(),
        }
    )
    save_project(fe, project)
    _emit(progress, "index", 1, 1)

    return {"sourceId": ds_id, "tables": [table], "rowCount": len(rows)}
