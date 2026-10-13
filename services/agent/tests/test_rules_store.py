from fireeyeaud_agent.config import store as cfg
from fireeyeaud_agent.store.rules import (
    create_rule,
    delete_rule,
    list_rules,
    update_rule,
)


def test_custom_rules_crud(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    root.mkdir()
    assert list_rules(root) == []

    created = create_rule(
        {
            "name": "大额关联方",
            "description": "查关联方大额往来",
            "sql": "SELECT 1",
            "databaseId": "conn_1",
            "enabled": True,
            "scope": "project",
        },
        root,
    )
    assert created["id"].startswith("rule_")
    assert created["scope"] == "project"
    assert created["databaseId"] == "conn_1"

    update_rule(root, created["id"], "project", {"description": "更新描述", "databaseId": None})
    after = {r["id"]: r for r in list_rules(root)}
    assert after[created["id"]]["description"] == "更新描述"
    assert after[created["id"]]["databaseId"] is None


def test_delete_rule(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    root.mkdir()
    created = create_rule({"name": "x", "sql": "SELECT 1", "scope": "project"}, root)

    delete_rule(root, created["id"], "project")
    assert list_rules(root) == []


def test_rule_project_overrides_global(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    root.mkdir()
    cfg.put_item(
        "rules",
        {"id": "rule_x", "name": "全局", "sql": "", "enabled": True, "scope": "global"},
        root,
    )
    cfg.put_item(
        "rules",
        {"id": "rule_x", "name": "项目", "sql": "", "enabled": True, "scope": "project"},
        root,
    )
    items = {r["id"]: r for r in list_rules(root)}
    assert items["rule_x"]["name"] == "项目"
    assert items["rule_x"]["scope"] == "project"
