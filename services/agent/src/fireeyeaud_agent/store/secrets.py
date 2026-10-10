"""sidecar 内存凭据（设计 §17.2：明文仅内存持有，不落盘、不写日志）。

主进程经 `POST /api/v1/secrets` 全量下发；模拟测试可用 `set_one` / `remove`。
"""

from __future__ import annotations

_SECRETS: dict[str, str] = {}


def set_all(items: dict[str, str]) -> None:
    _SECRETS.clear()
    _SECRETS.update({str(k): str(v) for k, v in (items or {}).items()})


def set_one(ref: str, value: str) -> None:
    if value:
        _SECRETS[str(ref)] = str(value)


def remove(ref: str) -> None:
    _SECRETS.pop(ref, None)


def get(ref: str | None) -> str | None:
    if not ref:
        return None
    return _SECRETS.get(ref)


def clear() -> None:
    _SECRETS.clear()
