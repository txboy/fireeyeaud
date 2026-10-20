"""文件写入工具：同目录临时文件 + 原子替换，避免读到半截 JSON。"""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any


def write_json_atomic(path: Path, data: Any) -> None:
    """原子写入 JSON。Windows 上目标文件可能被短暂占用，做有限重试。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        last_exc: OSError | None = None
        for attempt in range(5):
            try:
                os.replace(tmp_path, path)
                return
            except OSError as exc:  # 目标被短暂占用时稍后重试
                last_exc = exc
                time.sleep(0.02 * (attempt + 1))
        assert last_exc is not None
        raise last_exc
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass
