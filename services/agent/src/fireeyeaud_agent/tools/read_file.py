"""read_file：读取工作区文件内容。

本地可抽取的文本/表格/docx/有文字层 PDF 直接同步抽取；图片与扫描版 PDF
复用附件读取器做视觉转写（异步）。结果按内容 sha256 落盘缓存，避免重复抽取
与重复烧 LLM；视觉结果按 (sha256, modelId) 区分。
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..store import attachments as att
from ..store import file_cache
from ..store.workspace_files import resolve_in_workspace, to_rel

_NEEDS_VISION = "当前模型不支持图片/扫描件转写，请在 Models 中启用支持视觉的模型，或把该文件作为附件发送。"


def _kind(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in att.IMAGE_SUFFIXES:
        return "image"
    if suffix in att.PDF_SUFFIXES:
        return "pdf"
    if suffix in att.TABLE_SUFFIXES:
        return "table"
    if suffix in att.DOCX_SUFFIXES:
        return "docx"
    return "text"


def _result(
    root: Path, path: Path, *, cached: bool = False, **extra: Any
) -> dict[str, Any]:
    base: dict[str, Any] = {
        "path": to_rel(root, path),
        "kind": _kind(path),
        "text": "",
        "truncated": False,
        "source": "local",
        "cached": cached,
    }
    base.update(extra)
    return base


async def read_file(
    root: Path,
    params: dict[str, Any],
    *,
    model_id: str | None = None,
    build_model: Callable[[], Any] | None = None,
) -> dict[str, Any]:
    # 延迟导入：避免 tools -> agent -> tools.registry 的循环导入。
    from ..agent.attachment_reader import MIN_PDF_TEXT_CHARS, read_attachments

    root = Path(root)
    rel = params.get("path")
    path = resolve_in_workspace(root, rel)
    if not path.exists() or not path.is_file():
        raise ApiError(
            "E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"path": rel or ""}
        )
    try:
        size = path.stat().st_size
    except OSError:
        raise ApiError(
            "E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"path": rel or ""}
        ) from None
    if size > att.MAX_BYTES:
        raise ApiError(
            "E_FILE_TOO_LARGE", 413, "error.fileTooLarge", {"path": rel or ""}
        )

    suffix = path.suffix.lower()
    local: att.AttachmentText | None = None
    if suffix in att.IMAGE_SUFFIXES:
        vision = True
    elif suffix in att.PDF_SUFFIXES:
        local = att.extract_one(path)
        vision = not (
            local.error is None and len(local.text.strip()) >= MIN_PDF_TEXT_CHARS
        )
    else:
        vision = False

    sha = file_cache.file_sha256(path)
    kind = _kind(path)
    cache_model = model_id if vision else None

    hit = file_cache.load(root, sha, kind=kind, model_id=cache_model)
    if hit is not None:
        return _result(
            root,
            path,
            cached=True,
            text=hit.get("text") or "",
            truncated=bool(hit.get("truncated")),
            source=hit.get("source") or ("vision" if vision else "local"),
        )

    # 同一文件首次抽取/转写串行化，避免并发重复烧 LLM。
    async with file_cache.lock_for(sha, kind=kind, model_id=cache_model):
        hit = file_cache.load(root, sha, kind=kind, model_id=cache_model)
        if hit is not None:
            return _result(
                root,
                path,
                cached=True,
                text=hit.get("text") or "",
                truncated=bool(hit.get("truncated")),
                source=hit.get("source") or ("vision" if vision else "local"),
            )

        if vision:
            if build_model is None:
                return _result(root, path, error="needsVision", message=_NEEDS_VISION)
            read = await read_attachments(
                root,
                model_id,
                [{"path": str(path), "name": path.name}],
                build_model=build_model,
            )
            if read.texts:
                item = read.texts[0]
                result = _result(
                    root,
                    path,
                    text=item.text,
                    truncated=item.truncated,
                    source=item.source,
                )
            elif read.unsupported:
                return _result(
                    root, path, error="needsVision", message=_NEEDS_VISION
                )
            else:
                return _result(
                    root, path, error="readFailed", message="无法读取该文件。"
                )
        else:
            extracted = local or att.extract_one(path)
            if extracted.error == "unsupported":
                return _result(
                    root, path, error="unsupported", message="该文件类型暂不支持解析。"
                )
            if extracted.error:
                return _result(
                    root, path, error=extracted.error, message="无法读取该文件。"
                )
            result = _result(
                root,
                path,
                text=extracted.text,
                truncated=extracted.truncated,
                source="local",
            )

        file_cache.save(
            root,
            sha,
            {
                "path": result["path"],
                "text": result["text"],
                "truncated": result["truncated"],
                "source": result["source"],
            },
            kind=kind,
            model_id=cache_model,
        )
        return result
