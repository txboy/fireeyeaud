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


def _ws(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    return tmp_path / "ws"


def test_effective_ids_default_union_selected_and_enabled(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    a = skills.create_skill(
        {"name": "A", "prompt": "pa", "enabled": True, "isDefault": True, "scope": "project"},
        root=root,
    )
    b = skills.create_skill(
        {"name": "B", "prompt": "pb", "enabled": True, "scope": "project"},
        root=root,
    )
    c = skills.create_skill(
        {"name": "C", "prompt": "pc", "enabled": False, "isDefault": True, "scope": "project"},
        root=root,
    )
    assert skills.effective_ids(root) == {a["id"]}
    assert skills.effective_ids(root, [b["id"]]) == {a["id"], b["id"]}
    # 未启用者即使被勾选也不生效。
    assert skills.effective_ids(root, [b["id"], c["id"]]) == {a["id"], b["id"]}


def test_catalog_for_is_metadata_only_and_skips_eager(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    skills.create_skill(
        {
            "name": "收入舞弊",
            "prompt": "识别收入确认异常。",
            "description": "一句话描述。",
            "whenToUse": "分析收入时。",
            "enabled": True,
            "isDefault": True,
            "scope": "project",
        },
        root=root,
    )
    skills.create_skill(
        {
            "name": "常驻技能",
            "prompt": "正文。",
            "eager": True,
            "enabled": True,
            "isDefault": True,
            "scope": "project",
        },
        root=root,
    )
    skills.create_skill(
        {"name": "停用", "prompt": "x", "enabled": False, "isDefault": True, "scope": "project"},
        root=root,
    )

    cat = skills.catalog_for(root)
    assert len(cat) == 1
    entry = cat[0]
    assert entry["name"] == "收入舞弊"
    assert entry["description"] == "一句话描述。"
    assert entry["whenToUse"] == "分析收入时。"
    assert "prompt" not in entry  # 只含元数据


def test_catalog_for_derives_description_from_prompt(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    skills.create_skill(
        {
            "name": "关联方交易",
            "prompt": "梳理关联方资金往来的核对要点。\n更多正文。",
            "enabled": True,
            "isDefault": True,
            "scope": "project",
        },
        root=root,
    )
    cat = skills.catalog_for(root)
    assert cat[0]["description"] == "梳理关联方资金往来的核对要点。"
    assert "whenToUse" not in cat[0]


def test_catalog_for_derives_description_from_name_when_prompt_whitespace(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    skills.create_skill(
        {
            "name": "名称兜底",
            "prompt": "   ",
            "enabled": True,
            "isDefault": True,
            "scope": "project",
        },
        root=root,
    )
    assert skills.catalog_for(root)[0]["description"] == "名称兜底"


def test_get_prompt_enabled_only(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    a = skills.create_skill(
        {"name": "A", "prompt": "正文 A", "enabled": True, "scope": "project"}, root=root
    )
    d = skills.create_skill(
        {"name": "D", "prompt": "正文 D", "enabled": False, "scope": "project"}, root=root
    )
    got = skills.get_prompt(root, a["id"])
    assert got == {"id": a["id"], "name": "A", "prompt": "正文 A"}
    assert skills.get_prompt(root, d["id"]) is None
    assert skills.get_prompt(root, "sk_missing") is None
