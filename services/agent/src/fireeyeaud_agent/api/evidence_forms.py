"""取证单路由：写作台（草稿 / 大纲 / 章节 / 校验 / 导出 / 对话）与回执。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from ..agent.form_agent import stream_form_chat
from ..errors import ApiError
from ..store import evidence_forms, form_docs
from ..store.form_verify import verify_form
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["evidence-forms"], dependencies=[Depends(require_token)])

Scope = Literal["global", "project"]


def _root() -> Path:
    root = workspace_manager.root
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    return Path(root)


class DraftBody(BaseModel):
    templateId: str
    templateScope: Scope
    findingIds: list[str] = []
    header: dict[str, str] = {}
    title: str | None = None


class OutlineBody(BaseModel):
    sections: list[dict[str, Any]]
    approved: bool = False


class SectionBody(BaseModel):
    blocks: list[dict[str, Any]] = []


class TitleBody(BaseModel):
    title: str


class FindingsBody(BaseModel):
    findingIds: list[str] = []


class ExportBody(BaseModel):
    title: str | None = None


class ChatBody(BaseModel):
    message: str = ""
    locale: str | None = None
    modelId: str | None = None


class ReceiptBody(BaseModel):
    path: str
    note: str | None = None


@router.post("/evidence-forms/drafts", status_code=201)
def create_draft(body: DraftBody) -> dict:
    return form_docs.create_form(
        _root(),
        template_id=body.templateId,
        template_scope=body.templateScope,
        finding_ids=body.findingIds,
        header=body.header,
        title=body.title,
    )


@router.get("/evidence-forms")
def list_all() -> dict:
    return {"items": evidence_forms.list_evidence_forms(_root())}


@router.get("/evidence-forms/{form_id}")
def get_one(form_id: str) -> dict:
    return evidence_forms.load_manifest(_root(), form_id)


@router.get("/evidence-forms/{form_id}/doc")
def get_doc(form_id: str) -> dict:
    return form_docs.get_document(_root(), form_id)


@router.put("/evidence-forms/{form_id}/outline")
def put_outline(form_id: str, body: OutlineBody) -> dict:
    return form_docs.set_outline(
        _root(), form_id, body.sections, approved=body.approved
    )


@router.put("/evidence-forms/{form_id}/sections/{section_id}")
def put_section(form_id: str, section_id: str, body: SectionBody) -> dict:
    return form_docs.write_section(_root(), form_id, section_id, body.blocks)


@router.put("/evidence-forms/{form_id}/title")
def put_title(form_id: str, body: TitleBody) -> dict:
    return form_docs.set_title(_root(), form_id, body.title)


@router.put("/evidence-forms/{form_id}/findings")
def put_findings(form_id: str, body: FindingsBody) -> dict:
    return form_docs.set_findings(_root(), form_id, body.findingIds)


@router.post("/evidence-forms/{form_id}/verify")
def verify(form_id: str) -> dict:
    return verify_form(_root(), form_id)


@router.post("/evidence-forms/{form_id}/export")
def export(form_id: str, body: ExportBody) -> dict:
    return form_docs.export_form(_root(), form_id, title=body.title)


@router.get("/evidence-forms/{form_id}/messages")
def messages(form_id: str) -> dict:
    return {"items": form_docs.load_chat(_root(), form_id, limit=200)}


@router.post("/evidence-forms/{form_id}/chat")
async def chat(form_id: str, body: ChatBody) -> EventSourceResponse:
    async def generate():
        async for event in stream_form_chat(
            _root(),
            form_id,
            body.message,
            model_id=body.modelId,
            locale=body.locale,
        ):
            yield {
                "event": str(event.get("event") or "message"),
                "data": json.dumps(event.get("data") or {}, ensure_ascii=False),
            }

    return EventSourceResponse(generate(), media_type="text/event-stream")


@router.post("/evidence-forms/{form_id}/receipt")
def attach(form_id: str, body: ReceiptBody) -> dict:
    return evidence_forms.attach_receipt(
        _root(), form_id, Path(body.path), note=body.note
    )


@router.delete("/evidence-forms/{form_id}/receipt")
def clear(form_id: str) -> dict:
    return evidence_forms.clear_receipt(_root(), form_id)


@router.delete("/evidence-forms/{form_id}")
def remove(form_id: str) -> dict:
    evidence_forms.delete_evidence_form(_root(), form_id)
    return {"ok": True}