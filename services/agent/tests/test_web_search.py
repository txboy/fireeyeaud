import pytest

from fireeyeaud_agent import web
from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store import app_settings, secrets
from fireeyeaud_agent.tools import web_search as web_search_tool


def test_web_search_disabled(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    with pytest.raises(ApiError) as ei:
        web_search_tool.web_search(tmp_path, {"query": "x"})
    assert ei.value.code == "E_WEB_DISABLED"


def test_web_search_enabled_normalizes(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    secrets.clear()
    app_settings.patch(
        {"webSearch": {"enabled": True, "provider": "tavily", "keyRef": "sec_1"}}
    )
    secrets.set_one("sec_1", "k")
    calls: dict = {}

    def fake_search(api_key, query, *, max_results=5, client=None):
        calls["api_key"] = api_key
        calls["query"] = query
        calls["max_results"] = max_results
        return [{"title": "T", "url": "u", "content": "c", "score": 1.0}]

    monkeypatch.setattr(web.tavily, "search", fake_search)
    out = web_search_tool.web_search(tmp_path, {"query": "收入", "maxResults": 2})
    assert out["provider"] == "tavily"
    assert out["results"][0]["title"] == "T"
    assert calls["api_key"] == "k"
    assert calls["query"] == "收入"
    assert calls["max_results"] == 2
    secrets.clear()


def test_web_search_custom_uses_base_url(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    secrets.clear()
    app_settings.patch(
        {
            "webSearch": {
                "enabled": True,
                "provider": "custom",
                "keyRef": "sec_2",
                "baseUrl": "http://engine/search",
            }
        }
    )
    secrets.set_one("sec_2", "k2")
    calls: dict = {}

    def fake_search(base_url, api_key, query, *, max_results=5, client=None):
        calls["base_url"] = base_url
        calls["api_key"] = api_key
        return [{"title": "T", "url": "u", "content": "c", "score": None}]

    monkeypatch.setattr(web.custom, "search", fake_search)
    out = web_search_tool.web_search(tmp_path, {"query": "q"})
    assert out["provider"] == "custom"
    assert calls["base_url"] == "http://engine/search"
    assert calls["api_key"] == "k2"
    secrets.clear()
