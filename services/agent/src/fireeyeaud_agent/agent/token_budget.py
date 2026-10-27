"""Token 估算与上下文预算（Phase 9 · 上下文压缩）。

统一估算器：优先 `tiktoken`（OpenAI-compatible 常见），不可用时回退启发式
（CJK ≈ 1 token/字，拉丁 ≈ 4 字符/token）。不同模型分词不同，故预算层再用
`safety_factor` 留冗余。

预算公式（方案 §4.1）：

    可用预算 = contextWindow - reserveOutput
    安全预算 = 可用预算 × safetyFactor
    触发阈值 = 安全预算 × threshold
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import BaseMessage

# 图像内容块按固定预算估算（base64 原文不能按字符数折算，会严重高估）。
IMAGE_TOKEN_ALLOWANCE = 1000

_encoder: Any = None
_encoder_failed = False


def _is_cjk(ch: str) -> bool:
    code = ord(ch)
    return (
        0x4E00 <= code <= 0x9FFF  # CJK 统一表意
        or 0x3400 <= code <= 0x4DBF  # 扩展 A
        or 0x3000 <= code <= 0x303F  # CJK 标点
        or 0xFF00 <= code <= 0xFFEF  # 全角字符
        or 0x3040 <= code <= 0x30FF  # 日文假名
        or 0xAC00 <= code <= 0xD7AF  # 谚文
    )


def heuristic_tokens(text: str) -> int:
    """无分词器时的启发式估算：CJK 每字 1 token，其余每 4 字符 1 token。"""
    if not text:
        return 0
    cjk = sum(1 for ch in text if _is_cjk(ch))
    other = len(text) - cjk
    return cjk + (other + 3) // 4


def estimate_tokens(text: str) -> int:
    """估算文本 token 数；优先 tiktoken，失败回退启发式。"""
    if not text:
        return 0
    global _encoder, _encoder_failed
    if not _encoder_failed:
        try:
            if _encoder is None:
                import tiktoken

                _encoder = tiktoken.get_encoding("cl100k_base")
            return len(_encoder.encode(text))
        except Exception:  # 未安装/无网络/编码缺失一律回退
            _encoder_failed = True
    return heuristic_tokens(text)


def _content_text(content: Any) -> tuple[str, int]:
    """把消息内容归一化为 (文本, 图像块数)。"""
    if isinstance(content, str):
        return content, 0
    if not isinstance(content, Iterable):
        return str(content), 0
    parts: list[str] = []
    images = 0
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict):
            kind = block.get("type")
            if kind == "image_url":
                images += 1
            elif kind == "text":
                parts.append(str(block.get("text") or ""))
    return "\n".join(parts), images


def estimate_messages_tokens(messages: Iterable[BaseMessage]) -> int:
    total = 0
    for message in messages:
        text, images = _content_text(getattr(message, "content", ""))
        total += estimate_tokens(text) + images * IMAGE_TOKEN_ALLOWANCE
    return total


def resolve_context_window(profile: dict[str, Any] | None, *, default: int) -> int:
    """窗口来源：档案 `contextWindow` → 保守默认值（方案 §6.2 第 5 条）。"""
    if profile:
        value = profile.get("contextWindow")
        if isinstance(value, int) and value > 0:
            return value
    return default


def resolve_reserve_output(profile: dict[str, Any] | None, *, default: int) -> int:
    """为回答预留的输出预算：档案 `maxOutputTokens` → 保守默认值。"""
    if profile:
        value = profile.get("maxOutputTokens")
        if isinstance(value, int) and value > 0:
            return value
    return default


@dataclass(frozen=True)
class Budget:
    window: int
    reserve_output: int
    safety_factor: float
    threshold: float

    @property
    def available(self) -> int:
        return max(0, self.window - self.reserve_output)

    @property
    def safe(self) -> int:
        return int(self.available * self.safety_factor)

    @property
    def trigger(self) -> int:
        return int(self.safe * self.threshold)


def compute_budget(
    window: int, reserve_output: int, safety_factor: float, threshold: float
) -> Budget:
    return Budget(
        window=int(window),
        reserve_output=int(reserve_output),
        safety_factor=float(safety_factor),
        threshold=float(threshold),
    )
