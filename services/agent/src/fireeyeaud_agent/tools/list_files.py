"""list_files：列出工作区目录树（只读；供 agent 感知工作区文件）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..store.workspace_files import EXCLUDED_DIRS, resolve_in_workspace, to_rel

_DEFAULT_DEPTH = 2
_DEFAULT_LIMIT = 200
_MAX_DEPTH = 8
_MAX_LIMIT = 1000


def _collect(base: Path, root: Path, depth: int, limit: int) -> tuple[list[dict], bool]:
    entries: list[dict[str, Any]] = []
    truncated = False

    def scan(current: Path, level: int) -> None:
        nonlocal truncated
        if level >= depth or truncated:
            return
        try:
            children = sorted(
                current.iterdir(), key=lambda p: (p.is_file(), p.name.lower())
            )
        except OSError:
            return
        for child in children:
            if child.name in EXCLUDED_DIRS:
                continue
            try:
                is_dir = child.is_dir()
                size = None if is_dir else child.stat().st_size
            except OSError:
                continue
            entries.append(
                {
                    "path": to_rel(root, child),
                    "name": child.name,
                    "type": "dir" if is_dir else "file",
                    "size": size,
                }
            )
            if len(entries) > limit:
                truncated = True
                return
            if is_dir:
                scan(child, level + 1)

    scan(base, 0)
    if truncated:
        entries = entries[:limit]
    return entries, truncated


def list_files(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    root = Path(root)
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
        depth = int(params.get("depth") or _DEFAULT_DEPTH)
    except (TypeError, ValueError):
        depth = _DEFAULT_DEPTH
    try:
        limit = int(params.get("limit") or _DEFAULT_LIMIT)
    except (TypeError, ValueError):
        limit = _DEFAULT_LIMIT
    depth = max(1, min(depth, _MAX_DEPTH))
    limit = max(1, min(limit, _MAX_LIMIT))

    entries, truncated = _collect(base, root, depth, limit)
    return {"path": to_rel(root, base), "entries": entries, "truncated": truncated}
