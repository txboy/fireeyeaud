import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store import knowledge
from fireeyeaud_agent.tools.kb_search import kb_search


def _seed(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    knowledge.create_provider(
        {
            "type": "dify",
            "name": "法规",
            "baseUrl": "http://kb",
            "scope": "project",
            "defaults": {"topK": 2, "scoreThreshold": 0.4},
        },
        api_key="k",
        root=tmp_path / "ws",
    )
    knowledge.set_enabled(
        "project",
        [
            {
                "providerId": "kb_1",
                "knowledgeId": "k1",
                "name": "准则",
                "enabled": True,
            },
            {
                "providerId": "kb_1",
                "knowledgeId": "k2",
                "name": "税法",
                "enabled": False,
            },
        ],
        tmp_path / "ws",
    )
    return tmp_path / "ws"


def test_kb_search_uses_enabled_and_merges(tmp_path, monkeypatch):
    ws = _seed(tmp_path, monkeypatch)
    from fireeyeaud_agent import kb

    calls = []

    class _Adapter:
        @staticmethod
        def retrieve(base_url, key, knowledge_id, query, **kw):
            calls.append((base_url, key, knowledge_id, query, kw))
            return [{"content": "命中", "docId": "d1", "docName": "n", "score": 0.9}]

    monkeypatch.setattr(kb, "adapter_for", lambda _t: _Adapter)
    result = kb_search(ws, {"query": "收入确认"})
    assert result["merged"] is False
    assert [c["knowledgeId"] for c in result["chunks"]] == ["k1"]
    assert result["chunks"][0]["provider"] == "dify"
    assert result["chunks"][0]["knowledgeName"] == "准则"
    assert calls[0][2] == "k1"
    assert calls[0][4]["top_k"] == 2
    assert calls[0][4]["score_threshold"] == 0.4


def test_kb_search_filters_by_kb_ids(tmp_path, monkeypatch):
    ws = _seed(tmp_path, monkeypatch)
    knowledge.set_enabled(
        "project",
        [
            {
                "providerId": "kb_1",
                "knowledgeId": "k1",
                "name": "准则",
                "enabled": True,
            },
            {
                "providerId": "kb_1",
                "knowledgeId": "k2",
                "name": "税法",
                "enabled": True,
            },
        ],
        ws,
    )
    from fireeyeaud_agent import kb

    seen = []

    class _Adapter:
        @staticmethod
        def retrieve(base_url, key, knowledge_id, query, **kw):
            seen.append(knowledge_id)
            return []

    monkeypatch.setattr(kb, "adapter_for", lambda _t: _Adapter)
    kb_search(ws, {"query": "q", "kbIds": ["k2"]})
    assert seen == ["k2"]


def test_kb_search_connection_error(tmp_path, monkeypatch):
    ws = _seed(tmp_path, monkeypatch)
    from fireeyeaud_agent import kb

    class _Adapter:
        @staticmethod
        def retrieve(*_a, **_k):
            raise RuntimeError("boom")

    monkeypatch.setattr(kb, "adapter_for", lambda _t: _Adapter)
    with pytest.raises(ApiError) as ei:
        kb_search(ws, {"query": "q"})
    assert ei.value.code == "E_KB_CONN"
