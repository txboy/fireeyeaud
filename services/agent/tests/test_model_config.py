import pytest

from fireeyeaud_agent.config.models import build_chat_model
from fireeyeaud_agent.config.settings import settings
from fireeyeaud_agent.errors import ApiError


def test_build_chat_model_from_settings(monkeypatch):
    monkeypatch.setattr(settings, "model_base_url", "http://127.0.0.1:11434/v1")
    monkeypatch.setattr(settings, "model_name", "qwen2.5")
    monkeypatch.setattr(settings, "model_api_key", None)
    model = build_chat_model()
    assert model.model_name == "qwen2.5"


def test_build_chat_model_requires_base_url(monkeypatch):
    monkeypatch.setattr(settings, "model_base_url", "")
    with pytest.raises(ApiError) as exc:
        build_chat_model()
    assert exc.value.code == "E_LLM_UNAVAILABLE"
