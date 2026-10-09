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
    events = read_events(path)
    return int(events[-1].get("seq", 0)) + 1 if events else 1


def append_event(path: Path, event: dict[str, Any]) -> dict[str, Any]:
    """按 seq 顺序原子追加（追加写 + flush + fsync），返回最终事件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    seq = next_seq(path)
    record = {"seq": seq, **event}
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(line)
        fh.flush()
        os.fsync(fh.fileno())
    return record
