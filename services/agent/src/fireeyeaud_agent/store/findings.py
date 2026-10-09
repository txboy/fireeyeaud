"""findings 事件流：created 写入 + 回放折叠（设计 §14.4）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..util import now_iso
from .jsonl import append_event, read_events
from .project import next_counter


def findings_path(root: Path) -> Path:
    return Path(root) / ".fireeye" / "findings.jsonl"


def create_finding(
    root: Path,
    *,
    title: str,
    description: str,
    severity: str,
    dataRefs: list[dict[str, Any]],
    sessionId: str,
    lang: str = "zh-CN",
    confidence: float | None = None,
    subjects: list[str] | None = None,
    amount: str | None = None,
    currency: str = "CNY",
    ruleKey: str | None = None,
    params: dict[str, Any] | None = None,
    origin: str = "agent",
) -> dict[str, Any]:
    root = Path(root)
    fe = root / ".fireeye"
    seq_id = next_counter(fe, "finding", root)
    event = {
        "event": "created",
        "id": f"F-{seq_id:04d}",
        "ts": now_iso(),
        "origin": origin,
        "ruleKey": ruleKey,
        "params": params or {},
        "title": {"lang": lang, "text": title} if title is not None else None,
        "description": {"lang": lang, "text": description}
        if description is not None
        else None,
        "severity": severity,
        "status": "pending",
        "subjects": subjects or [],
        "amount": amount,
        "currency": currency,
        "confidence": confidence,
        "dataRefs": dataRefs,
        "evidenceRefs": [],
        "sessionId": sessionId,
    }
    return append_event(findings_path(root), event)


def fold_findings(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按 id 回放折叠出当前疑点状态。"""
    folded: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for event in events:
        fid = event.get("id")
        if not fid:
            continue
        kind = event.get("event")
        if kind == "created":
            folded[fid] = {
                **event,
                "notes": [],
                "seq": event.get("seq"),
            }
            order.append(fid)
        elif fid in folded:
            if kind == "status_changed":
                folded[fid]["status"] = event.get("status", folded[fid]["status"])
            elif kind == "severity_changed":
                folded[fid]["severity"] = event.get("severity", folded[fid]["severity"])
            elif kind == "note_added":
                folded[fid].setdefault("notes", []).append(
                    {
                        "note": event.get("note"),
                        "author": event.get("author"),
                        "ts": event.get("ts"),
                    }
                )
    return [folded[fid] for fid in order]


def load_findings(root: Path) -> list[dict[str, Any]]:
    return fold_findings(read_events(findings_path(root)))


def get_finding(root: Path, finding_id: str) -> dict[str, Any] | None:
    for item in load_findings(root):
        if item.get("id") == finding_id:
            return item
    return None
