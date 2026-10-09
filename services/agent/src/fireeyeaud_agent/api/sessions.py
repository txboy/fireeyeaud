"""会话与对话（SSE）路由。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from ..agent import stream_chat
from ..util import now_iso
from .deps import require_token

router = APIRouter(tags=["sessions"], dependencies=[Depends(require_token)])


class CreateSessionBody(BaseModel):
    title: str | None = None
    dataSourceIds: list[str] | None = None


class ChatBody(BaseModel):
    message: str = Field(min_length=1)
    locale: str | None = None
    dataSourceIds: list[str] | None = None
    attachments: list[dict] | None = None


@router.post("/sessions")
def create_session(body: CreateSessionBody) -> dict[str, object]:
    return {
        "id": f"s_{uuid.uuid4().hex[:8]}",
        "title": body.title,
        "createdAt": now_iso(),
    }


@router.post("/sessions/{session_id}/chat")
async def chat(session_id: str, body: ChatBody) -> EventSourceResponse:
    return EventSourceResponse(
        stream_chat(session_id, body.message, body.locale),
        media_type="text/event-stream",
    )
