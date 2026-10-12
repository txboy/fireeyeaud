"""会话与对话（SSE）路由。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from ..agent import stream_chat
from ..errors import ApiError
from ..store import sessions as sessions_store
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["sessions"], dependencies=[Depends(require_token)])


class CreateSessionBody(BaseModel):
    title: str | None = None
    dataSourceIds: list[str] | None = None


class ChatBody(BaseModel):
    message: str = Field(min_length=1)
    locale: str | None = None
    modelId: str | None = None
    skillIds: list[str] = []
    kbProviderIds: list[str] = []
    dbConnectionIds: list[str] = []
    mcpServerIds: list[str] = []
    dataSourceIds: list[str] | None = None
    attachments: list[dict] | None = None


def _root():
    root = workspace_manager.root
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 400, "error.noWorkspace", {})
    return root


@router.post("/sessions")
def create_session(body: CreateSessionBody) -> dict[str, object]:
    root = _root()
    return sessions_store.create_session(root / ".fireeye", root, body.title)


@router.get("/sessions")
def list_sessions() -> dict[str, object]:
    root = _root()
    return {"items": sessions_store.list_sessions(root / ".fireeye")}


@router.get("/sessions/{session_id}/messages")
def get_messages(session_id: str) -> dict[str, object]:
    root = _root()
    return {"items": sessions_store.get_messages(root / ".fireeye", session_id)}


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str) -> dict[str, object]:
    root = _root()
    sessions_store.delete_session(root / ".fireeye", session_id)
    return {"ok": True}


@router.post("/sessions/{session_id}/chat")
async def chat(session_id: str, body: ChatBody) -> EventSourceResponse:
    return EventSourceResponse(
        stream_chat(
            session_id,
            body.message,
            body.locale,
            body.modelId,
            {
                "skillIds": body.skillIds,
                "kbProviderIds": body.kbProviderIds,
                "dbConnectionIds": body.dbConnectionIds,
                "mcpServerIds": body.mcpServerIds,
            },
            body.attachments,
        ),
        media_type="text/event-stream",
    )
