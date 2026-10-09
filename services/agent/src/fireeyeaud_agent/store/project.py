"""project.json 读写与计数型 ID（设计 §14.2 / §14.17）。"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from ..util import now_iso


def _default_project(root: Path) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "id": str(uuid.uuid4()),
        "name": root.name,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
        "defaultModelId": None,
        "counters": {
            "finding": 0,
            "rule": 0,
            "session": 0,
            "message": 0,
            "dataSource": 0,
            "connection": 0,
            "workingPaper": 0,
        },
        "dataSources": [],
    }


def project_path(fe: Path) -> Path:
    return fe / "project.json"


def load_project(fe: Path) -> dict[str, Any] | None:
    path = project_path(fe)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def save_project(fe: Path, project: dict[str, Any]) -> None:
    project["updatedAt"] = now_iso()
    path = project_path(fe)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(project, ensure_ascii=False, indent=2), "utf-8")


def ensure_project(fe: Path, root: Path) -> dict[str, Any]:
    """读取 project.json；不存在则用默认值初始化并落盘。"""
    project = load_project(fe)
    if project is None:
        project = _default_project(root)
        save_project(fe, project)
    return project


def next_counter(fe: Path, key: str, root: Path | None = None) -> int:
    project = load_project(fe)
    if project is None:
        project = _default_project(root or fe.parent)
    counters = project.setdefault("counters", {})
    value = int(counters.get(key, 0)) + 1
    counters[key] = value
    save_project(fe, project)
    return value
