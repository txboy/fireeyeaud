"""search_files：在工作区内按文件名模式（glob）或文件内容关键词检索。

- 仅给 `glob`：按 glob 匹配文件路径（`**` 支持多级），跳过 `.fireeye`。
- 给 `query`：在文本文件内容中查找关键词（默认忽略大小写），返回命中行。
- 二者同时给：先用 glob 限定文件集合，再做内容检索。
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..store import attachments as att
from ..store.workspace_files import (
    EXCLUDED_DIRS,
    resolve_in_workspace,
    to_rel,
)

_DEFAULT_LIMIT = 50
_MAX_LIMIT = 200


def _within(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def _prune(dirnames: list[str]) -> None:
    dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]


def _walk(base: Path, root_resolved: Path) -> Iterator[Path]:
    for dirpath, dirnames, filenames in os.walk(base, followlinks=False):
        _prune(dirnames)
        for name in filenames:
            path = Path(dirpath) / name
            if path.is_symlink() and not _within(path.resolve(), root_resolved):
                continue
            yield path


def _glob_files(base: Path, root_resolved: Path, pattern: str) -> list[Path]:
    out: list[Path] = []
    try:
        candidates = list(base.glob(pattern))
    except (ValueError, NotImplementedError, OSError):
        return out
    for path in candidates:
        if not path.is_file():
            continue
        try:
            rel = path.resolve().relative_to(root_resolved)
        except ValueError:
            continue  # 逃逸出工作区
        if any(part in EXCLUDED_DIRS for part in rel.parts):
            continue
        out.append(path)
    return out


def _content_matches(
    path: Path,
    root: Path,
    query: str,
    case_sensitive: bool,
    limit: int,
    matches: list[dict[str, Any]],
) -> bool:
    """扫描单个文件，追加命中；返回是否因达到上限而应停止。"""
    suffix = path.suffix.lower()
    if suffix not in att.TEXT_SUFFIXES:
        return False
    try:
        if path.stat().st_size > att.MAX_BYTES:
            return False
    except OSError:
        return False

    hay = query if case_sensitive else query.lower()
    try:
        text = att._read_text_file(path)
    except OSError:
        return False
    for index, raw in enumerate(text.splitlines(), start=1):
        line = raw.rstrip("\r")
        haystack = line if case_sensitive else line.lower()
        pos = haystack.find(hay)
        if pos < 0:
            continue
        if len(matches) >= limit:
            return True
        matches.append(
            {
                "path": to_rel(root, path),
                "line": index,
                "column": pos + 1,
                "text": line[:300],
            }
        )
    return False


def search_files(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    root = Path(root)
    root_resolved = root.resolve()
    pattern = str(params.get("glob") or "").strip()
    query = str(params.get("query") or "")
    if not pattern and not query:
        raise ApiError("E_SEARCH_EMPTY", 400, "error.searchEmpty", {})

    base = resolve_in_workspace(root, params.get("path"))
    if not base.exists():
        raise ApiError(
            "E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"path": params.get("path")}
        )
    if not base.is_dir():
        raise ApiError(
            "E_FILE_NOT_DIR", 400, "error.fileNotDir", {"path": params.get("path")}
        )

    try:
        limit = int(params.get("limit") or _DEFAULT_LIMIT)
    except (TypeError, ValueError):
        limit = _DEFAULT_LIMIT
    limit = max(1, min(limit, _MAX_LIMIT))

    if pattern:
        files = _glob_files(base, root_resolved, pattern)
    else:
        files = list(_walk(base, root_resolved))

    if not query:
        truncated = len(files) > limit
        matches = [{"path": to_rel(root, p), "name": p.name} for p in files[:limit]]
        return {"matches": matches, "truncated": truncated}

    case_sensitive = bool(params.get("caseSensitive"))
    matches: list[dict[str, Any]] = []
    truncated = False
    for path in files:
        if _content_matches(path, root, query, case_sensitive, limit, matches):
            truncated = True
            break
    return {"matches": matches, "truncated": truncated}
