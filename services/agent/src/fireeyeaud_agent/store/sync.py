"""工作区数据表文件 ↔ DuckDB 数据源自动对账（设计补充）。

扫描工作区内的表格文件，与已登记数据源做差集：
- 新增文件 → 导入；
- 文件已删除 → 移除数据源（DuckDB 表 + 登记，不动磁盘）；
- 文件内容变化（SHA 变化）→ 替换数据源（保持 sourceId 与表名）。

幂等、增量；单个文件失败不阻塞其余。
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from ..errors import ApiError
from .importer import _sha256, delete_source, import_source, replace_source
from .index import load_files
from .project import load_project

TABLE_SUFFIXES = (".csv", ".txt", ".xlsx", ".xlsm")
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


def sync_sources(root: Path, *, progress: Progress | None = None) -> dict:
    root = Path(root)
    fe = root / ".fireeye"
    project = load_project(fe) or {}
    sources = {
        str(s.get("id")): s
        for s in project.get("dataSources", [])
        if s.get("type") in FILE_SOURCE_TYPES
    }
    files_path = fe / "index" / "files.json"
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

    # 删除：已登记但文件已不存在
    for source_id, source in list(sources.items()):
        if str(source.get("path") or "") not in scanned:
            try:
                delete_source(root, source_id)
                removed.append(source_id)
            except ApiError as exc:
                errors.append({"sourceId": source_id, "code": exc.code})
        step()

    # 新增 / 修改
    for path_str, path in scanned.items():
        fingerprint = fingerprints.get(path_str)
        try:
            if fingerprint is None:
                result = import_source(root, path)
                added.append(result["sourceId"])
            elif fingerprint.get("sha256") != _sha256(path):
                source_id = str(fingerprint.get("sourceId"))
                source = sources.get(source_id)
                if source is None:
                    result = import_source(root, path)
                    added.append(result["sourceId"])
                else:
                    replace_source(root, source, path)
                    updated.append(source_id)
        except ApiError as exc:
            errors.append({"path": path_str, "code": exc.code})
        step()

    return {"added": added, "removed": removed, "updated": updated, "errors": errors}
