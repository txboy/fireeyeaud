"""工作区文件读取缓存（磁盘持久化，按内容 sha256 寻址）。

`read_file` 抽取/转写成本可能很高（尤其图片与扫描版 PDF 的视觉转写），
故把结果落盘到 `.fireeye/cache/files/`，内容不变即可跨轮次、跨重启命中。
视觉转写结果按 `(sha256, kind, modelId)` 区分：换模型、或同一份字节以
不同后缀（分类不同）出现时都不会错误复用。
"""

from __future__ import annotations

import asyncio
import hashlib
import re
from pathlib import Path
from typing import Any

from ..util import now_iso

_CHUNK = 1024 * 1024
# 缓存条目上限（超过后按修改时间淘汰最旧的）。
MAX_ENTRIES = 500

_locks: dict[str, asyncio.Lock] = {}


def _cache_dir(root: Path) -> Path:
    return Path(root) / ".fireeye" / "cache" / "files"


def _slug(model_id: str | None) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", model_id) if model_id else "local"


def _entry_path(
    root: Path, sha256: str, kind: str, model_id: str | None
) -> Path:
    return _cache_dir(root) / f"{sha256}__{_slug(kind)}__{_slug(model_id)}.json"


def lock_for(sha256: str, *, kind: str, model_id: str | None) -> asyncio.Lock:
    """同一 (sha256, kind, modelId) 的首次抽取/转写串行化，避免并发重复烧 LLM。"""
    key = f"{sha256}__{_slug(kind)}__{_slug(model_id)}"
    lock = _locks.get(key)
    if lock is None:
        lock = _locks[key] = asyncio.Lock()
    return lock


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load(
    root: Path, sha256: str, *, kind: str, model_id: str | None = None
) -> dict[str, Any] | None:
    import json

    path = _entry_path(root, sha256, kind, model_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def save(
    root: Path,
    sha256: str,
    record: dict[str, Any],
    *,
    kind: str,
    model_id: str | None = None,
) -> None:
    import json

    path = _entry_path(root, sha256, kind, model_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "sha256": sha256,
        "kind": kind,
        "modelId": model_id,
        "ts": now_iso(),
        **record,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")
    _evict(root)


def _evict(root: Path) -> None:
    directory = _cache_dir(root)
    try:
        entries = sorted(
            directory.glob("*.json"), key=lambda p: p.stat().st_mtime_ns
        )
    except OSError:
        return
    for stale in entries[:-MAX_ENTRIES] if len(entries) > MAX_ENTRIES else []:
        try:
            stale.unlink()
        except OSError:
            continue


def clear_file_cache(root: Path) -> int:
    """清空文件读取缓存，返回删除的条目数。"""
    directory = _cache_dir(root)
    if not directory.exists():
        return 0
    removed = 0
    for entry in directory.glob("*.json"):
        try:
            entry.unlink()
            removed += 1
        except OSError:
            continue
    return removed
