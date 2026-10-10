"""索引文件读写：schema.json（表结构摘要）、files.json（文件指纹）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _read(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")


def load_schema(path: Path) -> list[dict[str, Any]]:
    return _read(path, [])


def save_schema(path: Path, entries: list[dict[str, Any]]) -> None:
    _write(path, entries)


def upsert_schema_entry(path: Path, entry: dict[str, Any]) -> None:
    entries = [
        e
        for e in load_schema(path)
        if (e.get("sourceId"), e.get("table"))
        != (entry.get("sourceId"), entry.get("table"))
    ]
    entries.append(entry)
    save_schema(path, entries)


def load_files(path: Path) -> list[dict[str, Any]]:
    return _read(path, [])


def save_files(path: Path, entries: list[dict[str, Any]]) -> None:
    _write(path, entries)
