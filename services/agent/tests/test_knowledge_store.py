from fireeyeaud_agent.store import knowledge


def test_provider_crud_and_secret(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)

    p = knowledge.create_provider(
        {
            "type": "dify",
            "name": "法规库",
            "baseUrl": "https://api.dify.ai/v1",
            "scope": "project",
        },
        api_key="sk-1",
        root=tmp_path / "ws",
    )
    assert p["id"] == "kb_1"
    assert p["type"] == "dify"
    assert p["apiKeyRef"] == "kb_1"
    assert "apiKey" not in p

    assert knowledge.get_secret("kb_1") == "sk-1"
    assert [i["id"] for i in knowledge.list_providers(tmp_path / "ws")] == ["kb_1"]

    knowledge.delete_provider("kb_1", "project", tmp_path / "ws")
    assert knowledge.list_providers(tmp_path / "ws") == []
    assert knowledge.get_secret("kb_1") is None


def test_provider_rejects_unknown_type(tmp_path, monkeypatch):
    import pytest

    from fireeyeaud_agent.errors import ApiError

    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    with pytest.raises(ApiError) as ei:
        knowledge.create_provider(
            {
                "type": "weaviate",
                "name": "x",
                "baseUrl": "http://x",
                "scope": "project",
            },
            api_key=None,
            root=tmp_path / "ws",
        )
    assert ei.value.code == "E_KB_TYPE"


def test_enabled_effective_merge(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)
    knowledge.set_enabled(
        "global",
        [{"providerId": "kb_1", "knowledgeId": "a", "name": "准则", "enabled": True}],
        None,
    )
    knowledge.set_enabled(
        "project",
        [
            {
                "providerId": "kb_1",
                "knowledgeId": "a",
                "name": "准则",
                "enabled": False,
            },
            {"providerId": "kb_2", "knowledgeId": "b", "name": "税法", "enabled": True},
        ],
        root,
    )
    effective = {
        (e["providerId"], e["knowledgeId"]): e
        for e in knowledge.list_enabled_effective(root)
    }
    assert effective[("kb_1", "a")]["enabled"] is False
    assert effective[("kb_1", "a")]["scope"] == "project"
    assert effective[("kb_2", "b")]["enabled"] is True
    assert len(knowledge.list_enabled("global", None)) == 1
