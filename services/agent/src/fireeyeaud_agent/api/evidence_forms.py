"""取证单路由：预览、保存、列表、回执。"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..errors import ApiError
from ..store import evidence_forms
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["evidence-forms"], dependencies=[Depends(require_token)])

Scope = Literal["global", "project"]


def _root() -> Path:
    root = workspace_manager.root
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    return Path(root)


class PreviewBody(BaseModel):
    templateId: str
    templateScope: Scope
    findingIds: list[str]
    header: dict[str, str] = {}


class CommitBody(BaseModel):
    token: str
    title: str | None = None


class ReceiptBody(BaseModel):
    path: str


@router.post("/evidence-forms/preview")
def preview(body: PreviewBody) -> dict:
    return evidence_forms.preview_evidence_form(
        _root(),
        template_id=body.templateId,
        template_scope=body.templateScope,
        finding_ids=body.findingIds,
        header=body.header,
    )


@router.post("/evidence-forms", status_code=201)
def commit(body: CommitBody) -> dict:
    return evidence_forms.commit_evidence_form(_root(), body.token, body.title)


@router.get("/evidence-forms")
def list_all() -> dict:
    return {"items": evidence_forms.list_evidence_forms(_root())}


@router.get("/evidence-forms/{form_id}")
def get_one(form_id: str) -> dict:
    return evidence_forms.get_evidence_form(_root(), form_id)


@router.delete("/evidence-forms/{form_id}")
def remove(form_id: str) -> dict:
    evidence_forms.delete_evidence_form(_root(), form_id)
    return {"ok": True}


@router.post("/evidence-forms/{form_id}/receipt")
def attach(form_id: str, body: ReceiptBody) -> dict:
    return evidence_forms.attach_receipt(_root(), form_id, Path(body.path))


@router.delete("/evidence-forms/{form_id}/receipt")
def clear(form_id: str) -> dict:
    return evidence_forms.clear_receipt(_root(), form_id)