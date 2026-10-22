"""证据日志（`evidence.jsonl`）与 SHA-256 哈希链（设计 §14.5）。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..util import now_iso
from .jsonl import append_event, next_seq, read_events

_ARTIFACT_THRESHOLD = 16 * 1024


def evidence_path(root: Path) -> Path:
    return Path(root) / ".fireeye" / "evidence.jsonl"


def _canonical(obj: dict[str, Any]) -> str:
    """去 `hash` 后 key 递归字典序、紧凑 JSON（与写入顺序无关）。"""
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def compute_hash(prev_hash: str, event: dict[str, Any]) -> str:
    body = {k: v for k, v in event.items() if k != "hash"}
    digest = hashlib.sha256((prev_hash + _canonical(body)).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _prev_hash(path: Path) -> str:
    events = read_events(path)
    return events[-1].get("hash", "") if events else ""


def append_evidence(
    root: Path,
    *,
    session_id: str,
    step: str,
    tool: str | None = None,
    params: dict[str, Any] | None = None,
    result_summary: str | None = None,
    result: Any = None,
    finding_refs: list[str] | None = None,
    duration_ms: int | None = None,
    tokens: int | None = None,
    lang: str = "zh-CN",
    source: str = "agent",
    kind: str | None = None,
    title: str | None = None,
    note: str | None = None,
    file_path: str | None = None,
    file_hash: str | None = None,
) -> dict[str, Any]:
    root = Path(root)
    path = evidence_path(root)
    seq = next_seq(path)
    ev_id = f"ev_{seq}"

    artifact_ref = None
    if result is not None:
        payload = _canonical(result if isinstance(result, dict) else {"value": result})
        if len(payload.encode("utf-8")) > _ARTIFACT_THRESHOLD:
            target = root / ".fireeye" / "artifacts" / f"{ev_id}.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(result, ensure_ascii=False), "utf-8")
            artifact_ref = f"artifacts/{ev_id}.json"

    event: dict[str, Any] = {
        "seq": seq,
        "id": ev_id,
        "sessionId": session_id,
        "ts": now_iso(),
        "step": step,
        "findingRefs": finding_refs or [],
        "tool": tool,
        "params": params or {},
        "resultSummary": result_summary,
        "artifactRef": artifact_ref,
        "durationMs": duration_ms,
        "tokens": tokens,
        "lang": lang,
        "prevHash": _prev_hash(path),
    }
    # 人工证据的可选字段：只在有值时写入，保持 Agent 生成的事件形状不变。
    if source != "agent":
        event["source"] = source
        # 人工证据固定带 filePath / fileHash（文字证据为 null），便于前端统一处理
        event["filePath"] = file_path
        event["fileHash"] = file_hash
    if kind is not None:
        event["kind"] = kind
    if title is not None:
        event["title"] = title
    if note is not None:
        event["note"] = note
    event["hash"] = compute_hash(event["prevHash"], event)
    return append_event(path, event)


def append_manual_evidence(
    root: Path,
    *,
    finding_id: str,
    kind: str,
    title: str,
    note: str | None = None,
    source_path: Path | None = None,
    author: str | None = None,
) -> dict[str, Any]:
    """录入人工证据（文件 / 文字 / 核查记录）并挂接到疑点。

    - 文件：复制到项目根 `证据/`，sha256 计入哈希链
    - 文字 / 记录：只写证据日志，不落文件
    """
    from .evidence_files import copy_into_evidence
    from .findings import attach_evidence, get_finding

    root = Path(root)
    if get_finding(root, finding_id) is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": finding_id})
    if kind not in {"file", "text", "record"}:
        raise ApiError("E_INVALID_KIND", 400, "error.internal", {"kind": kind})
    if kind == "file" and source_path is None:
        raise ApiError("E_FILE_REQUIRED", 400, "error.fileRequired")

    file_path = file_hash = None
    size = None
    if kind == "file" and source_path is not None:
        file_path, size, file_hash = copy_into_evidence(root, source_path)

    event = append_evidence(
        root,
        session_id="",
        step="manual",
        tool=None,
        params={"kind": kind, "title": title, "size": size},
        result_summary=note or title,
        finding_refs=[finding_id],
        source="manual",
        kind=kind,
        title=title,
        note=note,
        file_path=file_path,
        file_hash=file_hash,
    )
    attached = attach_evidence(root, finding_id, str(event["id"]), author=author)
    if attached is None:
        # 疑点在此期间被删除：清理刚落盘的文件，避免留下无主证据
        if file_path:
            (root / file_path).unlink(missing_ok=True)
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": finding_id})
    return event


def load_evidence(
    root: Path, finding_id: str | None = None, limit: int = 200
) -> list[dict[str, Any]]:
    items = read_events(evidence_path(Path(root)))
    if finding_id:
        from .findings import get_finding

        finding = get_finding(Path(root), finding_id)
        refs = set(finding.get("evidenceRefs", [])) if finding else set()
        items = [e for e in items if e.get("id") in refs]
    return items[:limit]


def verify_evidence_chain(root: Path) -> dict[str, Any]:
    events = read_events(evidence_path(Path(root)))
    prev = ""
    for event in events:
        if event.get("prevHash", "") != prev:
            return {"ok": False, "breakAt": event.get("seq"), "reason": "prev_mismatch"}
        if event.get("hash") != compute_hash(prev, event):
            return {"ok": False, "breakAt": event.get("seq"), "reason": "hash_mismatch"}
        prev = event.get("hash")
    return {"ok": True, "breakAt": None, "count": len(events), "head": prev}
