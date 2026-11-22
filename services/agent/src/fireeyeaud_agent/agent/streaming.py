"""共享流式内核：超时、瞬时错误重试、usage 累计与 AI 消息合并。

所有对话入口（主对话、报告/取证单、SQL 助手）都走这里，
避免四套循环各自演化出不同的超时与重试语义。
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from langchain_core.messages import BaseMessage

from ..config.settings import settings
from .retry import is_retryable, retry_delay


@dataclass
class StreamCollector:
    ai: Any = None
    usage: dict[str, int] = field(default_factory=dict)
    emitted: bool = False


@asynccontextmanager
async def _maybe_timeout(seconds: float | None):
    if seconds and seconds > 0:
        async with asyncio.timeout(float(seconds)):
            yield
    else:
        yield


def _merge_usage(collector: StreamCollector, chunk: Any) -> None:
    usage = getattr(chunk, "usage_metadata", None)
    if not usage:
        return
    collector.usage["promptTokens"] = int(usage.get("input_tokens") or 0)
    collector.usage["completionTokens"] = int(usage.get("output_tokens") or 0)
    details = usage.get("input_token_details") or {}
    collector.usage["cachedTokens"] = int(details.get("cache_read") or 0)


async def iter_model(
    bound: Any,
    messages: list[BaseMessage],
    *,
    timeout_seconds: float | None,
    collector: StreamCollector,
    retry: bool = True,
    max_attempts: int | None = None,
) -> AsyncIterator[str]:
    """流式产出文本 delta；结束时 `collector.ai` 为合并后的消息。

    仅在「尚未产出任何正文」时重试，避免把已展示给用户的内容重复一遍。
    """
    attempts_limit = int(max_attempts or settings.llm_max_attempts)
    attempt = 0
    while True:
        attempt += 1
        collector.ai = None
        collector.emitted = False
        try:
            async with _maybe_timeout(timeout_seconds):
                async for chunk in bound.astream(messages):
                    collector.ai = (
                        chunk if collector.ai is None else collector.ai + chunk
                    )
                    _merge_usage(collector, chunk)
                    piece = chunk.content
                    if isinstance(piece, str) and piece:
                        collector.emitted = True
                        yield piece
            return
        except Exception as exc:
            if (
                not retry
                or collector.emitted
                or attempt >= attempts_limit
                or not is_retryable(exc)
            ):
                raise
            await asyncio.sleep(
                retry_delay(attempt, base=settings.llm_retry_base_seconds)
            )
