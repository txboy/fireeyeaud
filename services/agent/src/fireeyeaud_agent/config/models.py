"""OpenAI-compatible 模型解析（本地 Ollama/vLLM 或云端）。

优先使用模型面板的有效配置（global/project 合并），无配置时回退环境变量 `settings`。
API Key 由 Electron 主进程经 `/secrets` 下发，仅内存持有（设计 §17）。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from langchain_openai import ChatOpenAI

from ..errors import ApiError
from .settings import settings


def _effective_profile(root: Path | None) -> dict[str, Any] | None:
    from . import store as cfg_store

    try:
        items = cfg_store.load_effective("models", root)
    except Exception:  # 配置不可读时回退 settings
        return None
    if not items:
        return None
    return next((m for m in items if m.get("isDefault")), items[0])


def _profile_by_id(root: Path | None, model_id: str) -> dict[str, Any] | None:
    from . import store as cfg_store

    try:
        items = cfg_store.load_effective("models", root)
    except Exception:
        return None
    return next((m for m in items if m.get("id") == model_id), None)


def select_profile(
    root: Path | None, model_id: str | None = None
) -> dict[str, Any] | None:
    """按 id 选择模型档案；未指定则取默认（isDefault / 首个）。"""
    if model_id:
        return _profile_by_id(root, model_id)
    return _effective_profile(root)


def build_chat_model(
    root: Path | None = None, model_id: str | None = None
) -> ChatOpenAI:
    from ..store import secrets

    profile = select_profile(root, model_id)
    if profile:
        base_url = str(profile.get("baseUrl") or "").strip()
        model = str(profile.get("model") or "qwen2.5")
        temperature = float(profile.get("temperature") or 0.2)
        api_key = (
            secrets.get(profile.get("apiKeyRef"))
            or settings.model_api_key
            or "not-needed"
        )
    else:
        base_url = (settings.model_base_url or "").strip()
        model = settings.model_name
        temperature = settings.model_temperature
        api_key = settings.model_api_key or "not-needed"
    if not base_url:
        raise ApiError("E_LLM_UNAVAILABLE", 503, "error.llmUnavailable")
    return ChatOpenAI(
        base_url=base_url,
        model=model,
        api_key=api_key,
        temperature=temperature,
        # 单次请求超时：服务端挂起时尽快失败，而不是无限等待。
        timeout=settings.turn_timeout_seconds,
        max_retries=1,
    )
