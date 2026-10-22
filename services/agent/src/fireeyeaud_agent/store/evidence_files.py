"""人工证据文件：白名单、复制到项目根 `证据/`、sha256 指纹。"""

from __future__ import annotations

import hashlib
import os
import shutil
from pathlib import Path

from ..errors import ApiError

ALLOWED_EXT = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
    ".webp",
    ".docx",
    ".doc",
    ".xlsx",
    ".xls",
    ".csv",
    ".txt",
    ".md",
    ".eml",
    ".msg",
    ".zip",
}
MAX_SIZE = 50 * 1024 * 1024


def copy_into_evidence(root: Path, source: Path) -> tuple[str, int, str]:
    """把证据文件复制到 `证据/`，返回 (工作区相对路径, 字节数, sha256)。

    只取原文件名，绝不拼接调用方给的目录，避免路径穿越；同名时顺延为 `名称 (2).pdf`。
    """
    source = Path(source)
    if not source.is_file():
        raise ApiError(
            "E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"path": str(source)}
        )
    if source.suffix.lower() not in ALLOWED_EXT:
        raise ApiError("E_FILE_TYPE", 400, "error.evidenceFileType")
    size = source.stat().st_size
    if size > MAX_SIZE:
        raise ApiError("E_FILE_TOO_LARGE", 400, "error.evidenceFileTooLarge")

    target_dir = Path(root) / "证据"
    target: Path | None = None
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        target = _reserve(target_dir, source.name)
        shutil.copyfile(source, target)
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
    except OSError as exc:
        if target is not None:
            target.unlink(missing_ok=True)
        raise ApiError("E_FILE_WRITE", 500, "error.opFailed", {"name": source.name}) from exc

    rel = target.relative_to(Path(root)).as_posix()
    return rel, size, f"sha256:{digest}"


def _reserve(target_dir: Path, name: str) -> Path:
    """原子占位：`O_CREAT|O_EXCL` 抢到文件名，避免并发上传同名互相覆盖。"""
    stem, suffix = os.path.splitext(name)
    n = 1
    while True:
        candidate = target_dir / (name if n == 1 else f"{stem} ({n}){suffix}")
        try:
            handle = os.open(candidate, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            n += 1
            continue
        os.close(handle)
        return candidate