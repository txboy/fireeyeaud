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
from .index import load_files, remove_schema_entries, save_files, upsert_schema_entry
from .project import ensure_project, load_project, next_counter, save_project
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


def _read_table(path: Path) -> tuple[list[str], list[list[str]]]:
    try:
        return read_table(path)
    except Exception as exc:  # noqa: BLE001 - 解析失败统一转错误码
        raise ApiError(
            "E_IMPORT_PARSE",
            422,
            "error.importParse",
            {"path": str(path), "reason": str(exc)},
        ) from exc


def _write_table(fe: Path, table: str, columns: list[str], rows: list[list[str]]) -> None:
    db = Database(fe / "workspace.duckdb")
    try:
        with_rowid = [[str(i + 1), *[str(v) for v in row]] for i, row in enumerate(rows)]
        db.create_table_from_rows(table, ["__row_id", *columns], with_rowid)
    finally:
        db.close()


def _schema_entry(
    source_id: str, table: str, columns: list[str], rows: list[list[str]]
) -> dict:
    col_values = list(map(list, zip(*rows))) if rows else [[] for _ in columns]
    return {
        "sourceId": source_id,
        "table": table,
        "rowCount": len(rows),
        "headerRow": 1,
        "columns": [
            infer_column(name, values) for name, values in zip(columns, col_values)
        ],
    }


def _fingerprint(path: Path, source_id: str) -> dict:
    stat = path.stat()
    return {
        "path": str(path),
        "size": stat.st_size,
        "mtime": now_iso(),
        "sha256": _sha256(path),
        "sourceId": source_id,
        "importedAt": now_iso(),
        "status": "ok",
    }


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
    columns, rows = _read_table(path)
    _emit(progress, "parse", 1, 1)

    ds_seq = next_counter(fe, "dataSource", root)
    ds_id = f"ds_{ds_seq}"
    table = f"src_ds{ds_seq}_{sanitize_table_name(path.stem)}"

    _emit(progress, "load", 0, max(len(rows), 1))
    _write_table(fe, table, columns, rows)
    _emit(progress, "load", len(rows), max(len(rows), 1))

    _emit(progress, "index", 0, 1)
    upsert_schema_entry(
        fe / "index" / "schema.json", _schema_entry(ds_id, table, columns, rows)
    )
    save_files(
        files_path,
        [f for f in files if f.get("path") != str(path)] + [_fingerprint(path, ds_id)],
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


def replace_source(root: Path, source: dict, path: Path) -> dict:
    """按新文件内容替换已有数据源（保持 sourceId 与表名，用于文件被修改后的自动同步）。"""
    root = Path(root)
    path = Path(path)
    fe = root / ".fireeye"
    source_id = str(source.get("id"))
    tables = [str(t) for t in source.get("tables", [])]
    if not source_id or not tables:
        raise ApiError("E_DS_NOT_FOUND", 404, "error.dsNotFound", {"id": source_id})
    table = tables[0]

    columns, rows = _read_table(path)
    db = Database(fe / "workspace.duckdb")
    try:
        db.drop_table(table)
    finally:
        db.close()
    _write_table(fe, table, columns, rows)

    upsert_schema_entry(
        fe / "index" / "schema.json", _schema_entry(source_id, table, columns, rows)
    )
    files_path = fe / "index" / "files.json"
    current = load_files(files_path)
    save_files(
        files_path,
        [
            f
            for f in current
            if f.get("sourceId") != source_id and f.get("path") != str(path)
        ]
        + [_fingerprint(path, source_id)],
    )

    project = ensure_project(fe, root)
    for item in project.get("dataSources", []):
        if str(item.get("id")) == source_id:
            item["path"] = str(path)
            item["type"] = _source_type(path)
            item["importedAt"] = now_iso()
    save_project(fe, project)

    return {"sourceId": source_id, "tables": [table], "rowCount": len(rows)}


def delete_source(root: Path, source_id: str) -> dict:
    """删除已导入的数据源：DuckDB 表 + schema/files/project 登记（不动磁盘原文件）。

    `type == 'db'` 的数据源仅移除反射登记，不删除数据库连接本身。
    """
    root = Path(root)
    fe = root / ".fireeye"
    project = load_project(fe) or {}
    sources = project.get("dataSources", [])
    entry = next((s for s in sources if s.get("id") == source_id), None)
    if entry is None:
        raise ApiError("E_DS_NOT_FOUND", 404, "error.dsNotFound", {"id": source_id})

    tables = [str(t) for t in entry.get("tables", [])]
    if tables:
        db = Database(fe / "workspace.duckdb")
        try:
            for table in tables:
                db.drop_table(table)
        finally:
            db.close()

    remove_schema_entries(fe / "index" / "schema.json", source_id)
    files_path = fe / "index" / "files.json"
    save_files(
        files_path,
        [f for f in load_files(files_path) if f.get("sourceId") != source_id],
    )

    project["dataSources"] = [s for s in sources if s.get("id") != source_id]
    save_project(fe, project)
    return {"ok": True, "sourceId": source_id}
