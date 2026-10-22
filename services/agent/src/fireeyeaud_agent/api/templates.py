"""模板中心路由：全局 / 本项目双作用域（计划 2026-10-21-template-center）。"""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..errors import ApiError
from ..store import templates as templates_store
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["templates"], dependencies=[Depends(require_token)])

Scope = Literal["global", "project"]


def _root_or_none() -> Path | None:
    return workspace_manager.root


class UploadBody(BaseModel):
    kind: Literal["evidence-form", "report"]
    paths: list[str]
    scope: Scope = "project"
    name: str | None = None
    # 多选时只作用于第一份，避免同作用域出现多个默认。
    isDefault: bool = False


class PatchBody(BaseModel):
    name: str | None = None
    isDefault: bool | None = None
    # 目标作用域；与当前作用域不同时执行「搬家」。
    scope: Scope | None = None


class DuplicateBody(BaseModel):
    scope: Scope = "project"


class InspectBody(BaseModel):
    """新增模板时预览本地文件：只读，不写清单、不落盘。"""

    path: str
    kind: Literal["evidence-form", "report"]


class ReplaceBody(BaseModel):
    path: str


@router.get("/templates")
def list_all(
    kind: str | None = None,
    scope: Scope | None = Query(default=None),
) -> dict:
    items = templates_store.list_templates(_root_or_none(), kind)
    if scope is not None:
        items = [i for i in items if i["scope"] == scope]
    return {"items": items}


@router.post("/templates", status_code=201)
def upload(body: UploadBody) -> dict:
    root = _root_or_none()
    if body.scope == "project" and root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    if not body.paths:
        raise ApiError("E_FILE_REQUIRED", 400, "error.fileRequired")
    # 多选上传时使用各自文件名，避免所有项同名。
    name = body.name if len(body.paths) == 1 else None
    items = [
        templates_store.upload_template(
            root,
            Path(path),
            kind=body.kind,
            scope=body.scope,
            name=name,
            is_default=body.isDefault and index == 0,
        )
        for index, path in enumerate(body.paths)
    ]
    return {"items": items}


@router.patch("/templates/{template_id}")
def patch(
    template_id: str,
    body: PatchBody,
    scope: Scope = Query(default="global"),
) -> dict:
    fields = body.model_dump(exclude_unset=True)
    return templates_store.update_template(
        _root_or_none(),
        template_id,
        scope,
        name=fields.get("name"),
        is_default=fields.get("isDefault"),
        target_scope=fields.get("scope"),
    )


@router.post("/templates/inspect")
def inspect(body: InspectBody) -> dict:
    """新增模板表单的下半部分预览：读本地 docx（含体检），不保存任何东西。"""
    path = Path(body.path)
    if not path.is_file():
        raise ApiError(
            "E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"name": path.name}
        )
    if path.stat().st_size > templates_store.MAX_BYTES:
        raise ApiError(
            "E_FILE_TOO_LARGE", 400, "error.fileTooLarge", {"name": path.name}
        )
    check = templates_store.scan_docx(path, body.kind)  # 校验后缀 / 可解析
    size = path.stat().st_size
    data = path.read_bytes()
    return {
        "ok": True,
        "kind": "base64",
        "data": base64.b64encode(data).decode("ascii"),
        "mime": templates_store.DOCX_MIME,
        "size": size,
        "path": str(path),
        "name": path.stem,
        "fileName": path.name,
        "check": check,
    }


@router.delete("/templates/{template_id}")
def remove(
    template_id: str,
    scope: Scope = Query(default="global"),
) -> dict:
    templates_store.delete_template(_root_or_none(), template_id, scope)
    return {"ok": True}


@router.get("/templates/{template_id}/file")
def file(
    template_id: str,
    scope: Scope = Query(default="global"),
) -> FileResponse:
    path = templates_store.template_path(_root_or_none(), template_id, scope)
    if path is None:
        raise ApiError("E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"name": template_id})
    return FileResponse(path, filename=path.name, media_type=templates_store.DOCX_MIME)


@router.get("/templates/{template_id}/content")
def content(
    template_id: str,
    scope: Scope = Query(default="global"),
) -> dict:
    root = _root_or_none()
    data, mime = templates_store.read_template_content(root, template_id, scope)
    path = templates_store.template_path(root, template_id, scope)
    return {
        "ok": True,
        "kind": "base64",
        "data": base64.b64encode(data).decode("ascii"),
        "mime": mime,
        "size": len(data),
        "path": str(path) if path is not None else "",
    }


@router.post("/templates/{template_id}/replace")
def replace_file(
    template_id: str,
    body: ReplaceBody,
    scope: Scope = Query(default="global"),
) -> dict:
    """重新上传覆盖已有模板文件（保留 id / 名称 / 作用域 / 默认）。"""
    return templates_store.replace_template_file(
        _root_or_none(), template_id, scope, Path(body.path)
    )


@router.post("/templates/{template_id}/duplicate", status_code=201)
def duplicate(
    template_id: str,
    body: DuplicateBody,
    scope: Scope = Query(default="global"),
) -> dict:
    return templates_store.duplicate_template(
        _root_or_none(), template_id, scope, target_scope=body.scope
    )