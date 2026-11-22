"""read_artifact：按页回读 .fireeye/artifacts 下的外置结果。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..errors import ApiError

DEFAULT_LIMIT = 100
MAX_LIMIT = 1000


def _resolve(root: Path, ref: str) -> Path:
    base = (Path(root) / ".fireeye").resolve()
    target = (base / str(ref or "")).resolve()
    if target != base and base not in target.parents:
        raise ApiError("E_ARTIFACT_INVALID", 400, "error.artifactInvalid")
    if target.suffix.lower() != ".json":
        raise ApiError("E_ARTIFACT_INVALID", 400, "error.artifactInvalid")
    return target


def read_artifact(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    artifact_ref = str(params.get("artifactRef") or "")
    target = _resolve(root, artifact_ref)
    if not target.is_file():
        raise ApiError(
            "E_ARTIFACT_NOT_FOUND",
            404,
            "error.artifactNotFound",
            {"artifactRef": artifact_ref},
        )
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ApiError(
            "E_ARTIFACT_INVALID", 400, "error.artifactInvalid", {"reason": str(exc)}
        ) from exc
    if not isinstance(payload, dict):
        raise ApiError("E_ARTIFACT_INVALID", 400, "error.artifactInvalid")

    try:
        offset = max(0, int(params.get("offset") or 0))
        limit = int(params.get("limit") or DEFAULT_LIMIT)
    except (TypeError, ValueError):
        offset, limit = 0, DEFAULT_LIMIT
    limit = max(1, min(limit, MAX_LIMIT))

    rows = payload.get("rows")
    if not isinstance(rows, list):
        # 非表格 artifact（如工具结果快照）：整份回读，不做分页。
        return {"artifactRef": artifact_ref, "payload": payload}

    page = rows[offset : offset + limit]
    return {
        "artifactRef": artifact_ref,
        "columns": payload.get("columns") or [],
        "rows": page,
        "offset": offset,
        "totalRows": len(rows),
        "hasMore": offset + len(page) < len(rows),
        "sql": payload.get("sql"),
    }
