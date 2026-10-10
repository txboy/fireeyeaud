"""应用级设置（仅 global）——设计 §14.20 / §14.16。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..config import store

_DEFAULTS: dict[str, Any] = {
    "locale": "zh-CN",
    "theme": "light",
    "webSearch": {"enabled": False, "provider": "tavily", "keyRef": None},
    "telemetry": False,
}


def _path() -> Path:
    return store.global_config_dir() / "settings.json"


def load() -> dict[str, Any]:
    path = _path()
    data: dict[str, Any] = {}
    if path.exists():
        try:
            loaded = json.loads(path.read_text("utf-8"))
            data = loaded if isinstance(loaded, dict) else {}
        except (OSError, json.JSONDecodeError):
            data = {}
    merged = {**_DEFAULTS, **data}
    merged["webSearch"] = {**_DEFAULTS["webSearch"], **(data.get("webSearch") or {})}
    merged["telemetry"] = False
    return merged


def patch(update: dict[str, Any]) -> dict[str, Any]:
    current = load()
    merged = {**current, **{k: v for k, v in update.items() if v is not None}}
    if isinstance(update.get("webSearch"), dict):
        merged["webSearch"] = {**current["webSearch"], **update["webSearch"]}
    merged["telemetry"] = False
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), "utf-8")
    return merged
