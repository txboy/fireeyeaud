from pathlib import Path

from fireeyeaud_agent import kb
from fireeyeaud_agent.agent.graph import _allowed_ids, _registry_context
from fireeyeaud_agent.store import knowledge, skills
from fireeyeaud_agent.tools import kb_search as kb_tool


def _ws(tmp_path, monkeypatch) -> Path:
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    return tmp_path / "ws"


def test_allowed_ids_default_union_selected():
    items = [{"id": "x", "isDefault": True}, {"id": "y"}]
    assert _allowed_ids(items, ["y", "z"]) == {"x", "y", "z"}
    assert _allowed_ids(items, None) == {"x"}


def test_registry_context_none_means_unrestricted(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    assert _registry_context(root, None) is None


def test_prompts_for_default_union_selected(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    a = skills.create_skill(
        {"name": "A", "prompt": "pa", "enabled": True, "isDefault": True, "scope": "project"},
        root=root,
    )
    b = skills.create_skill(
        {"name": "B", "prompt": "pb", "enabled": True, "isDefault": False, "scope": "project"},
        root=root,
    )
    skills.create_skill(
        {"name": "C", "prompt": "pc", "enabled": False, "isDefault": True, "scope": "project"},
        root=root,
    )

    assert {s["id"] for s in skills.prompts_for(root)} == {a["id"]}
    assert {s["id"] for s in skills.prompts_for(root, [b["id"]])} == {a["id"], b["id"]}


class _FakeAdapter:
    def retrieve(self, base_url, key, kb_id, query, **kwargs):
        return [
            {
                "docId": "d",
                "docName": "n",
                "content": str(kb_id),
                "score": 1.0,
            }
        ]


def test_kb_search_provider_gate(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    p1 = knowledge.create_provider(
        {"type": "dify", "name": "P1", "baseUrl": "http://p1", "scope": "project"},
        root=root,
    )
    p2 = knowledge.create_provider(
        {"type": "dify", "name": "P2", "baseUrl": "http://p2", "scope": "project"},
        root=root,
    )
    knowledge.set_enabled(
        "project",
        [
            {"providerId": p1["id"], "knowledgeId": "k1", "name": "K1", "enabled": True},
            {"providerId": p2["id"], "knowledgeId": "k2", "name": "K2", "enabled": True},
        ],
        root,
    )
    monkeypatch.setattr(kb, "adapter_for", lambda _t: _FakeAdapter())

    limited = kb_tool.kb_search(root, {"query": "q", "allowedProviderIds": [p1["id"]]})
    assert {c["providerId"] for c in limited["chunks"]} == {p1["id"]}

    unrestricted = kb_tool.kb_search(root, {"query": "q"})
    assert {c["providerId"] for c in unrestricted["chunks"]} == {p1["id"], p2["id"]}
