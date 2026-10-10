from fireeyeaud_agent.store import skills


def test_builtin_seeded_and_custom_crud(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    root = tmp_path / "ws"

    items = skills.list_skills(root)
    assert any(s["builtin"] for s in items)

    custom = skills.create_skill(
        {
            "name": "舞弊风险聚焦",
            "prompt": "重点关注收入虚增与关联方交易。",
            "toolIds": ["sql_query"],
            "enabled": True,
            "scope": "project",
        },
        root=root,
    )
    assert custom["id"] == "sk_1"
    assert custom["builtin"] is False

    skills.update_skill("sk_1", "project", {"enabled": False}, root)
    enabled = [
        s for s in skills.list_skills(root) if s["enabled"] and not s.get("builtin")
    ]
    assert enabled == []


def test_enabled_prompts(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    root = tmp_path / "ws"
    skills.update_skill("sk_builtin_going_concern", "project", {"enabled": True}, root)
    prompts = skills.enabled_prompts(root)
    assert any("持续经营" in p["prompt"] for p in prompts)
