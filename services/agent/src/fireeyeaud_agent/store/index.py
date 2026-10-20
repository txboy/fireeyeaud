"""索引文件读写：schema.json（表结构摘要）、files.json（文件指纹）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .fsutil import write_json_atomic
from .lock import WORKSPACE_MUTATION_LOCK


def _read(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _write(path: Path, data) -> None:
    with WORKSPACE_MUTATION_LOCK:
        write_json_atomic(path, data)


def load_schema(path: Path) -> list[dict[str, Any]]:
    return _read(path, [])


def save_schema(path: Path, entries: list[dict[str, Any]]) -> None:
    _write(path, entries)


def upsert_schema_entry(path: Path, entry: dict[str, Any]) -> None:
    with WORKSPACE_MUTATION_LOCK:
        entries = [
            e
            for e in load_schema(path)
            if (e.get("sourceId"), e.get("table"))
            != (entry.get("sourceId"), entry.get("table"))
        ]
        entries.append(entry)
        save_schema(path, entries)


def remove_schema_entries(path: Path, source_id: str) -> None:
    with WORKSPACE_MUTATION_LOCK:
        save_schema(
            path, [e for e in load_schema(path) if e.get("sourceId") != source_id]
        )


def load_files(path: Path) -> list[dict[str, Any]]:
    return _read(path, [])


def save_files(path: Path, entries: list[dict[str, Any]]) -> None:
    with WORKSPACE_MUTATION_LOCK:
        _write(path, entries)
