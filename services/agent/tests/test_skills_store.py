from fireeyeaud_agent.store import skills


def test_custom_skill_crud(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    root = tmp_path / "ws"

    assert skills.list_skills(root) == []

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

    skills.update_skill("sk_1", "project", {"enabled": False}, root)
    enabled = [s for s in skills.list_skills(root) if s["enabled"]]
    assert enabled == []


def test_enabled_prompts(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    root = tmp_path / "ws"
    skills.create_skill(
        {
            "name": "持续经营",
            "prompt": "评估持续经营假设，关注现金流与到期债务。",
            "scope": "project",
            "enabled": True,
        },
        root=root,
    )
    prompts = skills.enabled_prompts(root)
    assert any("持续经营" in p["prompt"] for p in prompts)
