"""load_skill 工具（T4）：正文按需返回 + allowlist 门控。"""

from fireeyeaud_agent.store import skills
from fireeyeaud_agent.tools.load_skill import load_skill
from fireeyeaud_agent.tools.registry import build_tool_dict


def _ws(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    return tmp_path / "ws"


def _skill(root, name, prompt, **kw):
    data = {"name": name, "prompt": prompt, "enabled": True, "scope": "project"}
    data.update(kw)
    return skills.create_skill(data, root=root)


def test_load_skill_returns_body_when_allowed(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    a = _skill(root, "收入舞弊", "正文 A")
    out = load_skill(root, {"skillId": a["id"], "allowedSkillIds": {a["id"]}})
    assert out == {"id": a["id"], "name": "收入舞弊", "prompt": "正文 A"}


def test_load_skill_denied_outside_allowed_set(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    a = _skill(root, "A", "正文 A")
    assert load_skill(root, {"skillId": a["id"], "allowedSkillIds": set()}) == {
        "error": "not_allowed"
    }


def test_load_skill_denied_when_disabled_or_missing(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    d = _skill(root, "D", "正文 D", enabled=False)
    assert load_skill(root, {"skillId": d["id"], "allowedSkillIds": {d["id"]}}) == {
        "error": "not_allowed"
    }
    assert load_skill(root, {"skillId": "sk_missing", "allowedSkillIds": None}) == {
        "error": "not_allowed"
    }
    assert load_skill(root, {"skillId": "", "allowedSkillIds": None}) == {
        "error": "not_allowed"
    }


def test_load_skill_unrestricted_without_allowed_key(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    a = _skill(root, "A", "正文 A")
    out = load_skill(root, {"skillId": a["id"]})
    assert out["prompt"] == "正文 A"


def test_registry_injects_allowed_skill_ids(tmp_path, monkeypatch):
    root = _ws(tmp_path, monkeypatch)
    a = _skill(root, "A", "正文 A")
    b = _skill(root, "B", "正文 B")
    tools = build_tool_dict(root, {"allowedSkillIds": {a["id"]}})
    assert "load_skill" in tools
    assert tools["load_skill"](root, {"skillId": a["id"]})["prompt"] == "正文 A"
    assert tools["load_skill"](root, {"skillId": b["id"]}) == {"error": "not_allowed"}
