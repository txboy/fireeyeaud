"""工作区文件访问沙箱与遍历（只读；供 agent 文件工具使用）。

所有经 agent 工具访问的路径都必须先经 `resolve_in_workspace` 校验：
解析真实路径（跟随软链接、消除 `..`）后必须位于工作区根内，且不得进入
`.fireeye/` 内部元数据目录。
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

from ..errors import ApiError

# 对 agent 隐藏的工作区内部目录。
EXCLUDED_DIRS = frozenset({".fireeye"})


def _within(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def resolve_in_workspace(root: Path, rel: str | None) -> Path:
    """把工作区相对路径解析为真实路径；越界或命中内部目录时抛 ApiError。"""
    root = Path(root).resolve()
    raw = (rel or "").strip().replace("\\", "/")
    candidate = (root / raw).resolve()
    if not _within(candidate, root):
        raise ApiError(
            "E_FILE_OUTSIDE", 403, "error.fileOutside", {"path": rel or ""}
        )
    parts = candidate.relative_to(root).parts
    if any(part in EXCLUDED_DIRS for part in parts):
        raise ApiError(
            "E_FILE_FORBIDDEN", 403, "error.fileForbidden", {"path": rel or ""}
        )
    return candidate


def to_rel(root: Path, path: Path) -> str:
    """把绝对路径转为工作区相对 POSIX 路径（用于工具返回）。"""
    try:
        return path.resolve().relative_to(Path(root).resolve()).as_posix()
    except ValueError:
        return path.name


def walk_files(root: Path) -> Iterator[Path]:
    """遍历工作区内文件（跳过 `EXCLUDED_DIRS`，不跟随目录软链接）。"""
    root = Path(root)
    root_resolved = root.resolve()
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]
        for name in filenames:
            path = Path(dirpath) / name
            if path.is_symlink() and not _within(path.resolve(), root_resolved):
                continue
            yield path
