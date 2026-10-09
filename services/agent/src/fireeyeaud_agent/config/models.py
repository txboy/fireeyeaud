"""OpenAI-compatible 模型解析（本地 Ollama/vLLM 或云端）。"""

from __future__ import annotations

from langchain_openai import ChatOpenAI

from ..errors import ApiError
from .settings import settings


def build_chat_model() -> ChatOpenAI:
    base_url = (settings.model_base_url or "").strip()
    if not base_url:
        raise ApiError("E_LLM_UNAVAILABLE", 503, "error.llmUnavailable")
    return ChatOpenAI(
        base_url=base_url,
        model=settings.model_name,
        api_key=settings.model_api_key or "not-needed",
        temperature=settings.model_temperature,
    )
