"""项目归档路由（Git 模式）。"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..errors import ApiError
from ..store import app_settings, archive, archive_conflict, secrets
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["archive"], dependencies=[Depends(require_token)])


def _root() -> Path:
    root = workspace_manager.root
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    return Path(root)


def _author(name: str | None, email: str | None) -> dict[str, str]:
    return archive.resolve_author({"name": name or "", "email": email or ""})


def _password(cred_ref: str | None) -> str | None:
    return secrets.get(cred_ref) if cred_ref else None


class CommitBody(BaseModel):
    message: str | None = None
    authorName: str | None = None
    authorEmail: str | None = None


class RemoteBody(BaseModel):
    url: str
    username: str = ""
    credRef: str | None = None
    autoPush: bool = False


class PushBody(BaseModel):
    archiveId: str | None = None


class ConflictResolveBody(BaseModel):
    base: Literal["local", "remote"]
    choices: dict[str, Literal["local", "remote", "both", "auto"]]
    message: str
    authorName: str | None = None
    authorEmail: str | None = None


class CloneBody(BaseModel):
    url: str
    targetDir: str
    username: str = ""
    credRef: str | None = None


class RestoreBody(BaseModel):
    archiveId: str
    targetDir: str


@router.get("/archive/status")
def status() -> dict:
    return archive.archive_status(_root())


@router.post("/archive/init")
def init() -> dict:
    return archive.init_repo(_root())


@router.post("/archive/commit")
def commit(body: CommitBody) -> dict:
    return archive.commit_archive(
        _root(),
        message=body.message,
        author=_author(body.authorName, body.authorEmail),
    )


@router.get("/archive/history")
def history() -> dict:
    return {"items": archive.list_archives(_root())}


@router.get("/archive/{archive_id}/changes")
def changes(archive_id: str) -> dict:
    return {"items": archive.archive_changes(_root(), archive_id)}


@router.post("/archive/remote")
def set_remote(body: RemoteBody) -> dict:
    return archive.set_remote(
        _root(),
        url=body.url,
        username=body.username,
        cred_ref=body.credRef,
        auto_push=body.autoPush,
    )


@router.post("/archive/push")
def push(body: PushBody) -> dict:
    config = archive.load_archive_config(_root())
    password = _password(config.get("credRef"))
    return archive.push_archive(
        _root(), archive_id=body.archiveId, password=password
    )


@router.post("/archive/conflict/check")
def conflict_check() -> dict:
    config = archive.load_archive_config(_root())
    return archive_conflict.check_conflict(
        _root(), password=_password(config.get("credRef"))
    )


@router.post("/archive/conflict/resolve")
def conflict_resolve(body: ConflictResolveBody) -> dict:
    config = archive.load_archive_config(_root())
    return archive_conflict.resolve_conflict(
        _root(),
        base=body.base,
        choices=body.choices,
        message=body.message,
        author=_author(body.authorName, body.authorEmail),
        password=_password(config.get("credRef")),
    )


@router.post("/archive/clone")
def clone(body: CloneBody) -> dict:
    """从远程 clone（不需要已打开工作区）。"""
    password = _password(body.credRef)
    return archive.clone_from_remote(
        url=body.url,
        target=Path(body.targetDir),
        username=body.username,
        password=password,
        cred_ref=body.credRef,
    )


@router.post("/archive/restore")
def restore(body: RestoreBody) -> dict:
    return archive.restore_archive(
        _root(), archive_id=body.archiveId, target=Path(body.targetDir)
    )


@router.get("/archive/author")
def author() -> dict:
    """当前生效的归档作者（供前端预填）。"""
    return app_settings.load().get("archive") or {"authorName": "", "authorEmail": ""}