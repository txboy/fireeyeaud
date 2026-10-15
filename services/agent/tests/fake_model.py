"""测试用假模型：支持流式输出（含 tool_calls）。

`GenericFakeChatModel._stream` 只处理文本与 `function_call`，遇到带 `tool_calls`
的消息会产出空块并报 `No generation chunks were returned`。这里覆写为把每条消息
整体作为一个 chunk 产出。
"""

from __future__ import annotations

from collections.abc import Iterator

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGenerationChunk


class FakeChatModel(GenericFakeChatModel):
    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager=None,
        **kwargs,
    ) -> Iterator[ChatGenerationChunk]:
        message = next(self.messages)
        if isinstance(message, str):
            message = AIMessage(content=message)
        chunk = AIMessageChunk(
            content=message.content or "",
            tool_calls=list(message.tool_calls or []),
            additional_kwargs=dict(message.additional_kwargs or {}),
        )
        yield ChatGenerationChunk(message=chunk)
