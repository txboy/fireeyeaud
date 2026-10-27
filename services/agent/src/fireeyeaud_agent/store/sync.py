"""工作区数据表文件 ↔ DuckDB 数据源自动对账（设计补充）。

扫描工作区内的表格文件，与已登记数据源做差集：
- 新增文件 → 导入；
- 文件已删除 → 移除数据源（DuckDB 表 + 登记，不动磁盘）；
- 文件内容变化（SHA 变化）→ 替换数据源（保持 sourceId 与表名）。

`full=True` 时忽略指纹缓存，重新解析并覆盖全部表格文件，用于启动/手动刷新。

幂等；单个文件失败不阻塞其余。
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from ..errors import ApiError
from .duckdb import Database
from .importer import _sha256, delete_source, import_source, replace_source
from .index import load_files, load_schema, save_files, save_schema
from .lock import WORKSPACE_MUTATION_LOCK
from .project import load_project

# `.txt` 是自由文本，不参与自动导入；需要分析的自由文本走 read_file / 预览。
TABLE_SUFFIXES = (".csv", ".xlsx", ".xlsm")
FILE_SOURCE_TYPES = ("csv", "excel")
Progress = Callable[[str, int, int], None]


def _is_table_file(name: str) -> bool:
    lower = name.lower()
    if lower.startswith("~$") or lower.startswith("."):
        return False
    return lower.endswith(TABLE_SUFFIXES)


def scan_table_files(root: Path) -> list[Path]:
    """递归扫描工作区里的表格文件（排除 .fireeye 与隐藏/临时文件）。"""
    out: list[Path] = []
    for path in Path(root).rglob("*"):
        if ".fireeye" in path.parts:
            continue
        if path.is_file() and _is_table_file(path.name):
            out.append(path)
    return out


def _unchanged(path: Path, fingerprint: dict | None) -> bool:
    """size + mtime（纳秒）都没变 → 不必重读文件算指纹。

    旧版本指纹只记了导入时刻的 `mtime`（ISO 字符串），不是源文件时间，无法用于比较，
    一律视为「不确定」→ 回退到算 sha256。
    """
    if not fingerprint:
        return False
    source_mtime = fingerprint.get("mtimeNs")
    if not isinstance(source_mtime, int):
        return False
    try:
        stat = path.stat()
    except OSError:
        return False
    return (
        fingerprint.get("size") == stat.st_size
        and source_mtime == stat.st_mtime_ns
        and bool(fingerprint.get("sha256"))
    )


def sync_sources(
    root: Path,
    *,
    progress: Progress | None = None,
    full: bool = False,
) -> dict:
    root = Path(root)
    with WORKSPACE_MUTATION_LOCK:
        return _sync_sources_locked(root, progress=progress, full=full)


def _sync_sources_locked(
    root: Path,
    *,
    progress: Progress | None,
    full: bool,
) -> dict:
    fe = root / ".fireeye"
    project = load_project(fe) or {}
    sources = {
        str(s.get("id")): s
        for s in project.get("dataSources", [])
        if s.get("type") in FILE_SOURCE_TYPES
    }
    files_path = fe / "index" / "files.json"
    schema_path = fe / "index" / "schema.json"
    fingerprints = {str(f.get("path")): f for f in load_files(files_path)}
    scanned = {str(p): p for p in scan_table_files(root)}

    added: list[str] = []
    removed: list[str] = []
    updated: list[str] = []
    errors: list[dict] = []

    total = max(len(scanned) + len(sources), 1)
    done = 0

    def step() -> None:
        nonlocal done
        done += 1
        if progress is not None:
            progress("sync", done, total)

    # 删除：已登记但文件已不存在。
    for source_id, source in list(sources.items()):
        if str(source.get("path") or "") not in scanned:
            try:
                delete_source(root, source_id)
                removed.append(source_id)
            except ApiError as exc:
                errors.append({"sourceId": source_id, "code": exc.code})
            step()

    # 同一路径可能存在历史重复登记：保留有表的那个，其余删除。
    groups: dict[str, list[str]] = {}
    for source_id, source in sources.items():
        path_str = str(source.get("path") or "")
        if path_str in scanned:
            groups.setdefault(path_str, []).append(source_id)

    by_path: dict[str, dict] = {}
    for path_str, ids in groups.items():
        keep_id = next(
            (sid for sid in ids if sources[sid].get("tables")),
            ids[0],
        )
        by_path[path_str] = sources[keep_id]
        for source_id in ids:
            if source_id == keep_id:
                continue
            try:
                delete_source(root, source_id)
                removed.append(source_id)
            except ApiError as exc:
                errors.append({"sourceId": source_id, "code": exc.code})
            step()

    # 新增 / 修改 / 全量重导。
    for path_str, path in scanned.items():
        source = by_path.get(path_str)
        try:
            if source is None:
                result = import_source(root, path)
                if result["sourceId"] in sources:
                    updated.append(result["sourceId"])
                else:
                    added.append(result["sourceId"])
            else:
                # 增量：size + mtime 未变就不再读文件算 sha256（大工作区里这一步最贵）。
                changed = (
                    full
                    or path_str not in fingerprints
                    or (
                        not _unchanged(path, fingerprints.get(path_str))
                        and fingerprints[path_str].get("sha256") != _sha256(path)
                    )
                )
                if changed:
                    source_id = str(source.get("id"))
                    replace_source(root, source, path)
                    updated.append(source_id)
        except ApiError as exc:
            errors.append({"path": path_str, "code": exc.code})
        step()

    # 清理孤立指纹与 schema 条目，避免 project 重建后旧索引继续挡住导入。
    project = load_project(fe) or {}
    all_sources = project.get("dataSources", [])
    all_ids = {str(s.get("id")) for s in all_sources}
    file_ids = {
        str(s.get("id"))
        for s in all_sources
        if s.get("type") in FILE_SOURCE_TYPES
    }
    valid_file_tables = {
        str(table)
        for s in all_sources
        if s.get("type") in FILE_SOURCE_TYPES
        for table in s.get("tables", [])
    }

    kept_files: list[dict] = []
    seen_paths: set[str] = set()
    for fingerprint in load_files(files_path):
        path_str = str(fingerprint.get("path") or "")
        source_id = str(fingerprint.get("sourceId") or "")
        if path_str not in scanned or source_id not in file_ids:
            continue
        if path_str in seen_paths:
            continue
        seen_paths.add(path_str)
        kept_files.append(fingerprint)
    save_files(files_path, kept_files)

    kept_schema: list[dict] = []
    drop_tables: set[str] = set()
    for entry in load_schema(schema_path):
        source_id = str(entry.get("sourceId") or "")
        table = str(entry.get("table") or "")
        if source_id not in all_ids:
            if table and not entry.get("connectionId"):
                drop_tables.add(table)
            continue
        if source_id in file_ids and table not in valid_file_tables:
            if table:
                drop_tables.add(table)
            continue
        kept_schema.append(entry)
    if drop_tables:
        db = Database(fe / "workspace.duckdb")
        try:
            for table in drop_tables:
                db.drop_table(table)
        finally:
            db.close()
    save_schema(schema_path, kept_schema)

    return {"added": added, "removed": removed, "updated": updated, "errors": errors}
