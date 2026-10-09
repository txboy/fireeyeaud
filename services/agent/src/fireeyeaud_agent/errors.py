"""统一错误信封（设计 §14.8 / §16.1）。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ApiError(Exception):
    code: str
    http_status: int
    message_key: str
    params: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        return f"{self.code}({self.http_status}) {self.message_key}"

    @property
    def envelope(self) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "messageKey": self.message_key,
                "params": self.params,
                "traceId": None,
            }
        }
