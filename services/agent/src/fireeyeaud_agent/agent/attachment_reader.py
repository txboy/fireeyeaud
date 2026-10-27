"""附件读取器：把用户上传的附件一次性转成可随对话注入的文本。

策略「首步直传 + 之后文本」：
- 文本 / 表格 / docx / 有文字层的 PDF → 本地抽取，不调用模型；
- 图片 / 扫描版 PDF → 用当前（多模态）模型转写为文本，并在本轮首步直传原图；
- 当前模型不支持视觉时，图片 / 扫描版 PDF 记入 unsupported，由上层提示用户。

读取结果同时用于「当轮注入」与「落库历史回放」，从而解决跨轮次看不见附件的问题。
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import HumanMessage

from ..config.models import select_profile
from ..config.settings import settings
from ..store import attachments as att

# PDF 文字层达到该字符数即视为「有文字层」，无需视觉转写。
MIN_PDF_TEXT_CHARS = 8

TRANSCRIBE_PROMPT = (
    "你是文档转写助手。请把随附的图片/扫描页尽量忠实地转写为纯文本：\n"
    "1. 保留标题、正文、表格（可用 Markdown 表格）、金额、数字、日期与单位；\n"
    "2. 不要总结、不要省略、不要额外评论；\n"
    "3. 无法辨认处用〔?〕标注，保持原顺序。"
)


@dataclass
class AttachmentText:
    name: str
    text: str
    source: str = "local"  # local=本地抽取 | vision=模型转写
    truncated: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "text": self.text,
            "source": self.source,
            "truncated": self.truncated,
        }


@dataclass
class AttachmentReadResult:
    texts: list[AttachmentText] = field(default_factory=list)
    image_blocks: list[dict[str, Any]] = field(default_factory=list)
    unsupported: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _classify(path: Path) -> tuple[str, att.AttachmentText | None]:
    """返回 (种类, 已抽好的本地结果)。种类：text | image | scanned。"""
    suffix = path.suffix.lower()
    if suffix in att.IMAGE_SUFFIXES:
        return "image", None
    if suffix in att.PDF_SUFFIXES:
        local = att.extract_one(path)
        if local.error is None and len(local.text.strip()) >= MIN_PDF_TEXT_CHARS:
            return "text", local
        return "scanned", local
    return "text", None


def _file_blocks(path: Path) -> list[dict[str, Any]]:
    """把单个图片类附件编码为图像块（图片文件或 PDF 页）。"""
    blocks: list[dict[str, Any]] = []
    suffix = path.suffix.lower()
    if suffix in att.IMAGE_SUFFIXES:
        encoded = att.encode_image_file(path)
        if encoded is not None:
            blocks.append(_block(encoded[0], encoded[1]))
        return blocks
    for raw in att.pdf_page_images(path):
        encoded = att.encode_image_bytes(raw)
        if encoded is not None:
            blocks.append(_block(encoded[0], encoded[1]))
    return blocks


def _block(mime: str, encoded: str) -> dict[str, Any]:
    return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}}


def _cap(text: str, per_file: int, total: int) -> str:
    limit = max(0, min(per_file, total))
    return text[:limit] if len(text) > limit else text


async def _transcribe(model: Any, blocks: list[dict[str, Any]]) -> str:
    content: list[dict[str, Any]] = [{"type": "text", "text": TRANSCRIBE_PROMPT}, *blocks]
    parts: list[str] = []
    async with asyncio.timeout(settings.attachment_read_timeout_seconds):
        async for chunk in model.astream([HumanMessage(content=content)]):
            piece = getattr(chunk, "content", "")
            if isinstance(piece, str):
                parts.append(piece)
    return "".join(parts).strip()


async def read_attachments(
    root: Path,
    model_id: str | None,
    attachments: list[dict] | None,
    *,
    build_model: Callable[[], Any],
) -> AttachmentReadResult:
    """读取上传附件：本地抽取 + （必要时）模型转写；永不抛异常。"""
    result = AttachmentReadResult()
    items: list[tuple[str, str]] = []
    for item in attachments or []:
        raw_path = str(item.get("path") or "")
        if not raw_path:
            continue
        items.append((raw_path, str(item.get("name") or Path(raw_path).name)))
    if not items:
        return result

    try:
        vision = bool((select_profile(root, model_id) or {}).get("vision"))
    except Exception:  # 配置不可读时按不支持视觉处理
        vision = False

    per_file = settings.attachment_max_chars
    char_budget = settings.attachment_total_chars
    blocks_left = att.MAX_IMAGE_BLOCKS
    bytes_left = att.MAX_TOTAL_IMAGE_BYTES
    model: Any = None

    for raw_path, label in items:
        path = Path(raw_path)
        try:
            kind, local = _classify(path)
        except Exception:
            result.notes.append(f"### {label}\n（无法读取附件）")
            continue

        if kind == "text":
            extracted = local or att.extract_one(path)
            if extracted.error:
                result.notes.append(f"### {label}\n（无法读取附件）")
                continue
            text = _cap(extracted.text, per_file, char_budget)
            if not text.strip():
                result.notes.append(f"### {label}\n（无文本内容）")
                continue
            char_budget -= len(text)
            result.texts.append(
                AttachmentText(
                    label,
                    text,
                    "local",
                    truncated=extracted.truncated or len(text) < len(extracted.text),
                )
            )
            continue

        # image / scanned：需要视觉能力。
        if not vision:
            result.unsupported.append(label)
            continue

        blocks = _file_blocks(path)
        kept: list[dict[str, Any]] = []
        for block in blocks:
            size = len(block["image_url"]["url"]) * 3 // 4
            if blocks_left <= 0 or bytes_left < size:
                result.notes.append(f"### {label}\n（图片数量或体积超限，已忽略部分）")
                break
            kept.append(block)
            blocks_left -= 1
            bytes_left -= size
        if not kept:
            continue

        if model is None:
            try:
                model = build_model()
            except Exception:
                model = None
        text = ""
        if model is not None:
            try:
                text = await _transcribe(model, kept)
            except Exception:  # 超时/服务异常都退化为无法读取
                result.notes.append(f"### {label}\n（读取失败）")
                text = ""
        if text.strip():
            capped = _cap(text, per_file, char_budget)
            char_budget -= len(capped)
            result.texts.append(
                AttachmentText(label, capped, "vision", truncated=len(capped) < len(text))
            )
        result.image_blocks.extend(kept)

    return result
