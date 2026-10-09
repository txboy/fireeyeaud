"""工作区（项目）管理：`.fireeye/` 初始化、占用锁、project.json。

对应设计文档 §4（工作区模型）、§14.2（project.json）、§18（占用锁）。
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..config.settings import settings
from ..errors import ApiError

_SUBDIRS = ["config", "templates", "index", "artifacts"]
_COUNTERS = [
    "finding",
    "rule",
    "session",
    "message",
    "dataSource",
    "connection",
    "workingPaper",
]


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _pid_alive(pid: int) -> bool:
    """跨平台判断进程是否存活（无第三方依赖）。"""
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        process_query_limited_information = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(
            process_query_limited_information, False, pid
        )
        if not handle:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


class WorkspaceManager:
    def __init__(self) -> None:
        self.current: dict[str, Any] | None = None
        self.root: Path | None = None

    def open(self, path: str) -> dict[str, Any]:
        root = Path(path).expanduser()
        if not root.exists() or not root.is_dir():
            raise ApiError("E_PATH_INVALID", 400, "error.pathInvalid", {"path": path})

        fe = root / ".fireeye"
        lock = fe / ".lock"

        if lock.exists():
            try:
                data = json.loads(lock.read_text("utf-8"))
            except (OSError, json.JSONDecodeError):
                data = {}
            owner = int(data.get("pid", 0) or 0)
            if owner and owner != os.getpid() and _pid_alive(owner):
                raise ApiError("E_WS_LOCKED", 409, "error.wsLocked", {"pid": owner})

        project_file = fe / "project.json"
        existing: dict[str, Any] | None = None
        if project_file.exists():
            try:
                existing = json.loads(project_file.read_text("utf-8"))
            except (OSError, json.JSONDecodeError):
                existing = None
            if (
                existing
                and int(existing.get("schemaVersion", 1)) > settings.schema_version
            ):
                raise ApiError(
                    "E_WS_SCHEMA_TOO_NEW",
                    409,
                    "error.wsSchemaTooNew",
                    {"schemaVersion": existing.get("schemaVersion")},
                )

        fe.mkdir(parents=True, exist_ok=True)
        for sub in _SUBDIRS:
            (fe / sub).mkdir(exist_ok=True)

        project = self._load_or_init(project_file, root, existing)
        lock.write_text(
            json.dumps(
                {"pid": os.getpid(), "port": settings.port, "startedAt": _now()},
                ensure_ascii=False,
            ),
            "utf-8",
        )

        self.root = root
        self.current = project
        return project

    def _load_or_init(
        self, project_file: Path, root: Path, existing: dict[str, Any] | None
    ) -> dict[str, Any]:
        if existing:
            existing["updatedAt"] = _now()
            existing.setdefault("name", root.name)
            existing.setdefault("counters", {k: 0 for k in _COUNTERS})
            existing.setdefault("dataSources", [])
            existing.setdefault("schemaVersion", settings.schema_version)
            project_file.write_text(
                json.dumps(existing, ensure_ascii=False, indent=2), "utf-8"
            )
            return existing

        project: dict[str, Any] = {
            "schemaVersion": settings.schema_version,
            "id": str(uuid.uuid4()),
            "name": root.name,
            "createdAt": _now(),
            "updatedAt": _now(),
            "defaultModelId": None,
            "counters": {k: 0 for k in _COUNTERS},
            "dataSources": [],
        }
        project_file.write_text(
            json.dumps(project, ensure_ascii=False, indent=2), "utf-8"
        )
        return project

    def close(self) -> None:
        if self.root is not None:
            lock = self.root / ".fireeye" / ".lock"
            try:
                data = json.loads(lock.read_text("utf-8"))
            except (OSError, json.JSONDecodeError):
                data = {}
            if int(data.get("pid", 0) or 0) == os.getpid() and lock.exists():
                lock.unlink()
        self.root = None
        self.current = None


workspace_manager = WorkspaceManager()
