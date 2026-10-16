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


def test_registry_context_includes_allowed_rules(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    from fireeyeaud_agent.store import rules as rules_store

    default = rules_store.create_rule(
        {"name": "D", "sql": "select 1", "enabled": True, "isDefault": True, "scope": "project"},
        root=root,
    )
    other = rules_store.create_rule(
        {"name": "O", "sql": "select 2", "enabled": True, "scope": "project"},
        root=root,
    )
    disabled = rules_store.create_rule(
        {
            "name": "X",
            "sql": "select 3",
            "enabled": False,
            "isDefault": True,
            "scope": "project",
        },
        root=root,
    )

    ctx = _registry_context(root, {"ruleIds": [other["id"]]})
    assert ctx is not None
    assert ctx["allowedRuleIds"] == {default["id"], other["id"]}
    assert disabled["id"] not in ctx["allowedRuleIds"]

    assert _registry_context(root, {})["allowedRuleIds"] == {default["id"]}


def test_registry_context_includes_allowed_mcp_ids(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    from fireeyeaud_agent.store import mcp as mcp_store

    default = mcp_store.create_server(
        {
            "name": "D",
            "transport": "stdio",
            "command": "x",
            "enabled": True,
            "isDefault": True,
            "scope": "project",
        },
        root=root,
    )
    other = mcp_store.create_server(
        {"name": "O", "transport": "stdio", "command": "x", "enabled": True, "scope": "project"},
        root=root,
    )
    disabled = mcp_store.create_server(
        {
            "name": "X",
            "transport": "stdio",
            "command": "x",
            "enabled": False,
            "isDefault": True,
            "scope": "project",
        },
        root=root,
    )

    ctx = _registry_context(root, {"mcpServerIds": [other["id"]]})
    assert ctx["allowedMcpServerIds"] == {default["id"], other["id"]}
    assert disabled["id"] not in ctx["allowedMcpServerIds"]
    assert _registry_context(root, {})["allowedMcpServerIds"] == {default["id"]}


def test_registry_context_includes_allowed_skill_ids(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    default = skills.create_skill(
        {"name": "D", "prompt": "pd", "enabled": True, "isDefault": True, "scope": "project"},
        root=root,
    )
    other = skills.create_skill(
        {"name": "O", "prompt": "po", "enabled": True, "scope": "project"}, root=root
    )
    disabled = skills.create_skill(
        {
            "name": "X",
            "prompt": "px",
            "enabled": False,
            "isDefault": True,
            "scope": "project",
        },
        root=root,
    )

    ctx = _registry_context(root, {"skillIds": [other["id"]]})
    assert ctx["allowedSkillIds"] == {default["id"], other["id"]}
    assert disabled["id"] not in ctx["allowedSkillIds"]
    assert _registry_context(root, {})["allowedSkillIds"] == {default["id"]}


def test_run_rule_tool_gate(tmp_path, monkeypatch):
    import pytest

    from fireeyeaud_agent.errors import ApiError
    from fireeyeaud_agent.store import rules as rules_store
    from fireeyeaud_agent.tools import run_rule as rule_tool

    root = _ws(tmp_path, monkeypatch)
    saved = rules_store.create_rule(
        {"name": "R", "sql": "select 1 as n", "scope": "project"}, root=root
    )

    with pytest.raises(ApiError) as exc:
        rule_tool.run_rule(root, {"ruleId": saved["id"], "allowedRuleIds": ["rule_999"]})
    assert exc.value.message_key == "error.ruleUnauthorized"

    ok = rule_tool.run_rule(root, {"ruleId": saved["id"], "allowedRuleIds": [saved["id"]]})
    assert ok["ruleId"] == saved["id"]


def test_build_snapshot_only_selected_non_default(tmp_path, monkeypatch):
    from fireeyeaud_agent.agent.context_snapshot import build_snapshot
    from fireeyeaud_agent.store import rules as rules_store

    root = _ws(tmp_path, monkeypatch)
    default = rules_store.create_rule(
        {"name": "D", "sql": "select 1", "enabled": True, "isDefault": True, "scope": "project"},
        root=root,
    )
    picked = rules_store.create_rule(
        {"name": "S", "sql": "select 2", "enabled": True, "scope": "project"},
        root=root,
    )

    snap = build_snapshot(root, {"ruleIds": [default["id"], picked["id"]]}, None)
    assert snap["model"] is None
    assert snap["rules"] == [{"id": picked["id"], "name": "S"}]
    assert snap["database"] == [] and snap["knowledge"] == []


def test_build_snapshot_resolves_model_name(tmp_path, monkeypatch):
    from fireeyeaud_agent.agent.context_snapshot import build_snapshot
    from fireeyeaud_agent.config import store as config_store

    root = _ws(tmp_path, monkeypatch)
    model = config_store.create_item(
        "models",
        {"name": "本地模型", "provider": "openai", "baseUrl": "http://x", "model": "m", "scope": "global"},
    )
    snap = build_snapshot(root, {}, model["id"])
    assert snap["model"] == {"id": model["id"], "name": "本地模型"}


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
