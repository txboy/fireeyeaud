"""findings 事件流：created 写入 + 回放折叠（设计 §14.4）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..util import now_iso
from .jsonl import append_event, read_events
from .project import next_counter

_STATUS_BY_ACTION = {
    "confirm": "confirmed",
    "reject": "rejected",
    "mark": "in_review",
    "false_positive": "false_positive",
}


def findings_path(root: Path) -> Path:
    return Path(root) / ".fireeye" / "findings.jsonl"


def create_finding(
    root: Path,
    *,
    title: str | None = None,
    description: str | None = None,
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
    evidenceRefs: list[str] | None = None,
    author: str | None = None,
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
        "evidenceRefs": evidenceRefs or [],
        "sessionId": sessionId,
        "author": author,
    }
    return append_event(findings_path(root), event)


def delete_finding(
    root: Path, finding_id: str, *, author: str | None = None
) -> dict[str, Any] | None:
    """软删除：追加 `deleted` 事件，折叠后从列表隐藏（历史与产物保留）。"""
    root = Path(root)
    if get_finding(root, finding_id) is None:
        return None
    return append_event(
        findings_path(root),
        {
            "event": "deleted",
            "id": finding_id,
            "author": author,
            "ts": now_iso(),
        },
    )


def attach_evidence(
    root: Path, finding_id: str, evidence_id: str, *, author: str | None = None
) -> dict[str, Any] | None:
    """把证据挂到疑点上（重复挂接由折叠去重；已删除疑点拒绝）。"""
    root = Path(root)
    if get_finding(root, finding_id) is None:
        return None
    return append_event(
        findings_path(root),
        {
            "event": "evidence_attached",
            "id": finding_id,
            "evidenceId": evidence_id,
            "author": author,
            "ts": now_iso(),
        },
    )


def detach_evidence(
    root: Path, finding_id: str, evidence_id: str, *, author: str | None = None
) -> dict[str, Any] | None:
    """只解除疑点与证据的关联，不删除证据日志。"""
    root = Path(root)
    finding = get_finding(root, finding_id)
    if finding is None:
        return None
    if evidence_id not in (finding.get("evidenceRefs") or []):
        return None
    return append_event(
        findings_path(root),
        {
            "event": "evidence_detached",
            "id": finding_id,
            "evidenceId": evidence_id,
            "author": author,
            "ts": now_iso(),
        },
    )


def review_finding(
    root: Path,
    finding_id: str,
    *,
    action: str,
    reviewer: str,
    comment: str | None = None,
    note: str | None = None,
    note_lang: str = "zh-CN",
    severity: str | None = None,
    reason: str | None = None,
) -> dict[str, Any] | None:
    """追加复核事件；疑点不存在时返回 None。"""
    root = Path(root)
    if get_finding(root, finding_id) is None:
        return None
    if action in _STATUS_BY_ACTION:
        event: dict[str, Any] = {
            "event": "status_changed",
            "id": finding_id,
            "status": _STATUS_BY_ACTION[action],
            "reviewer": reviewer,
            "comment": comment,
            "ts": now_iso(),
        }
    elif action == "note":
        event = {
            "event": "note_added",
            "id": finding_id,
            "note": {"lang": note_lang, "text": note},
            "author": reviewer,
            "ts": now_iso(),
        }
    elif action == "severity":
        event = {
            "event": "severity_changed",
            "id": finding_id,
            "severity": severity,
            "reason": reason,
            "author": reviewer,
            "ts": now_iso(),
        }
    else:
        raise ApiError("E_INVALID_ACTION", 400, "error.internal", {"action": action})
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
                "reviews": [],
                "deleted": False,
                "seq": event.get("seq"),
            }
            order.append(fid)
        elif fid in folded:
            if kind == "deleted":
                folded[fid]["deleted"] = True
                folded[fid]["deletedAt"] = event.get("ts")
            elif kind == "evidence_attached":
                refs = folded[fid].setdefault("evidenceRefs", [])
                evidence_id = event.get("evidenceId")
                if evidence_id and evidence_id not in refs:
                    refs.append(evidence_id)
            elif kind == "evidence_detached":
                evidence_id = event.get("evidenceId")
                folded[fid]["evidenceRefs"] = [
                    ref
                    for ref in (folded[fid].get("evidenceRefs") or [])
                    if ref != evidence_id
                ]
            elif kind == "status_changed":
                folded[fid]["status"] = event.get("status", folded[fid]["status"])
                folded[fid].setdefault("reviews", []).append(
                    {
                        "event": "status_changed",
                        "status": event.get("status"),
                        "reviewer": event.get("reviewer"),
                        "comment": event.get("comment"),
                        "ts": event.get("ts"),
                    }
                )
            elif kind == "severity_changed":
                folded[fid]["severity"] = event.get("severity", folded[fid]["severity"])
                folded[fid].setdefault("reviews", []).append(
                    {
                        "event": "severity_changed",
                        "severity": event.get("severity"),
                        "reviewer": event.get("author"),
                        "comment": event.get("reason"),
                        "ts": event.get("ts"),
                    }
                )
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
    return [
        item
        for item in fold_findings(read_events(findings_path(root)))
        if not item.get("deleted")
    ]


def get_finding(root: Path, finding_id: str) -> dict[str, Any] | None:
    for item in load_findings(root):
        if item.get("id") == finding_id:
            return item
    return None
