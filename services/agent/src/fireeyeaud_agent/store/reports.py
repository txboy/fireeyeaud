"""项目报告：列表、manifest 读写与删除。

正文与导出由 ``report_docs`` 管理；旧的一步式「选模板 → 渲染」链路已删除
（改为报告写作台），本模块只剩存储层。
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from ..errors import ApiError

KIND = "report"
ARTIFACT_DIR = "reports"


def reports_dir(root: Path) -> Path:
    return Path(root) / ".fireeye" / "artifacts" / ARTIFACT_DIR


def _posix(path: Path, root: Path) -> str:
    return path.relative_to(Path(root)).as_posix()


def _manifest_path(root: Path, report_id: str) -> Path:
    return reports_dir(root) / report_id / "manifest.json"


def get_report(root: Path, report_id: str) -> dict[str, Any]:
    import re

    if not re.fullmatch(r"RPT-\d{4,}", report_id):
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": report_id})
    path = _manifest_path(Path(root), report_id)
    if not path.is_file():
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": report_id})
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError) as exc:
        raise ApiError("E_NOT_FOUND", 404, "error.artifactNotFound", {"id": report_id}) from exc


def list_reports(root: Path) -> list[dict[str, Any]]:
    base = reports_dir(Path(root))
    if not base.is_dir():
        return []
    items: list[dict[str, Any]] = []
    for entry in base.iterdir():
        manifest_path = entry / "manifest.json"
        if not manifest_path.is_file():
            continue
        try:
            manifest = json.loads(manifest_path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        if manifest.get("kind") == KIND:
            items.append(manifest)
    items.sort(
        key=lambda i: str(i.get("updatedAt") or i.get("createdAt") or ""),
        reverse=True,
    )
    return items


def delete_report(root: Path, report_id: str) -> None:
    root = Path(root)
    get_report(root, report_id)
    shutil.rmtree(reports_dir(root) / report_id, ignore_errors=True)