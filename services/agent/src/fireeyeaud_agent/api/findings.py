"""findings 查询路由（设计 §14.8）。"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..errors import ApiError
from ..store.evidence import append_manual_evidence
from ..store.findings import (
    create_finding,
    delete_finding,
    detach_evidence,
    get_finding,
    load_findings,
    review_finding,
)
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["findings"], dependencies=[Depends(require_token)])

_MAX_LIMIT = 200
_SEVERITIES = {"high", "medium", "low"}
_EVIDENCE_KINDS = {"file", "text", "record"}


def _root() -> Path:
    if workspace_manager.root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    return workspace_manager.root


@router.get("/findings")
def list_findings(
    severity: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> dict:
    if workspace_manager.root is None:
        return {"items": [], "nextCursor": None}
    items = load_findings(workspace_manager.root)
    if severity:
        items = [i for i in items if i.get("severity") == severity]
    if status:
        items = [i for i in items if i.get("status") == status]
    limit = max(1, min(int(limit), _MAX_LIMIT))
    return {"items": items[:limit], "nextCursor": None}


class ReviewBody(BaseModel):
    action: str
    reviewer: str = "审计员"
    comment: str | None = None
    note: str | None = None
    noteLang: str = "zh-CN"
    severity: str | None = None
    reason: str | None = None


class CreateFindingBody(BaseModel):
    title: str
    description: str | None = None
    severity: str = "medium"
    subjects: list[str] = []
    amount: str | None = None
    currency: str = "CNY"
    author: str = "审计员"
    lang: str = "zh-CN"


class EvidenceBody(BaseModel):
    kind: str
    title: str
    note: str | None = None
    path: str | None = None


@router.post("/findings", status_code=201)
def create_manual(body: CreateFindingBody) -> dict:
    """人工创建疑点（origin=manual）。"""
    title = body.title.strip()
    if not title:
        raise ApiError("E_INVALID_TITLE", 400, "error.invalidTitle")
    if body.severity not in _SEVERITIES:
        raise ApiError("E_INVALID_SEVERITY", 400, "error.invalidSeverity")
    return create_finding(
        _root(),
        title=title,
        description=(body.description or "").strip() or None,
        severity=body.severity,
        dataRefs=[],
        sessionId="",
        lang=body.lang,
        subjects=[s.strip() for s in body.subjects if s.strip()],
        amount=(body.amount or "").strip() or None,
        currency=body.currency or "CNY",
        origin="manual",
        author=body.author or "审计员",
    )


@router.get("/findings/{finding_id}")
def finding_detail(finding_id: str) -> dict:
    item = get_finding(_root(), finding_id)
    if item is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": finding_id})
    return item


@router.delete("/findings/{finding_id}")
def delete_one(finding_id: str, author: str = "审计员") -> dict:
    result = delete_finding(_root(), finding_id, author=author)
    if result is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": finding_id})
    return {"ok": True, "id": finding_id}


@router.post("/findings/{finding_id}/evidence", status_code=201)
def add_evidence(finding_id: str, body: EvidenceBody) -> dict:
    if body.kind not in _EVIDENCE_KINDS:
        raise ApiError("E_INVALID_KIND", 400, "error.invalidKind")
    if not body.title.strip():
        raise ApiError("E_INVALID_TITLE", 400, "error.invalidTitle")
    event = append_manual_evidence(
        _root(),
        finding_id=finding_id,
        kind=body.kind,
        title=body.title.strip(),
        note=(body.note or "").strip() or None,
        source_path=Path(body.path) if body.path else None,
        author="审计员",
    )
    return {"evidence": event, "finding": get_finding(_root(), finding_id)}


@router.delete("/findings/{finding_id}/evidence/{evidence_id}")
def remove_evidence(finding_id: str, evidence_id: str) -> dict:
    result = detach_evidence(_root(), finding_id, evidence_id, author="审计员")
    if result is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": evidence_id})
    return {"ok": True, "finding": get_finding(_root(), finding_id)}


@router.post("/findings/{finding_id}/review")
def review(finding_id: str, body: ReviewBody) -> dict:
    result = review_finding(
        _root(),
        finding_id,
        action=body.action,
        reviewer=body.reviewer,
        comment=body.comment,
        note=body.note,
        note_lang=body.noteLang,
        severity=body.severity,
        reason=body.reason,
    )
    if result is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": finding_id})
    return result
