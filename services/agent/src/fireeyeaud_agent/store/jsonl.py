"""JSONL 事件流读写：原子追加、半行截断、seq 推导（设计 §14.17 / §16.4 / §18）。"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def read_events(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    text = path.read_text("utf-8")
    events: list[dict[str, Any]] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            break  # 崩溃产生的半行：截断到最后一个完整事件（§16.4）
    return events


def next_seq(path: Path) -> int:
    last = last_event(path)
    return int(last.get("seq", 0)) + 1 if last else 1


_TAIL_CHUNK = 64 * 1024


def last_event(path: Path) -> dict[str, Any] | None:
    """从文件尾增量读取最后一个完整事件。

    追加路径只需要 seq 与 prevHash，不应为了这两项读完整份 JSONL。
    """
    if not path.exists():
        return None
    with open(path, "rb") as fh:
        fh.seek(0, os.SEEK_END)
        pos = fh.tell()
        buf = b""
        while pos > 0:
            step = min(_TAIL_CHUNK, pos)
            pos -= step
            fh.seek(pos)
            buf = fh.read(step) + buf
            text = buf.decode("utf-8", errors="replace")
            lines = [line for line in text.split("\n") if line.strip()]
            for line in reversed(lines):
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    # 崩溃留下的半行：跳过，继续找上一条完整事件。
                    continue
            if pos == 0:
                return None
    return None


def append_event(
    path: Path, event: dict[str, Any], *, seq: int | None = None
) -> dict[str, Any]:
    """按 seq 顺序原子追加（追加写 + flush + fsync），返回最终事件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    if seq is None:
        seq = next_seq(path)
    record = {"seq": seq, **event}
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(line)
        fh.flush()
        os.fsync(fh.fileno())
    return record
