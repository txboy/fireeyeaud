"""证据日志（`evidence.jsonl`）与 SHA-256 哈希链（设计 §14.5）。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

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
    event["hash"] = compute_hash(event["prevHash"], event)
    return append_event(path, event)


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
