from fireeyeaud_agent.store.rules import (
    create_rule,
    list_rules,
    set_enabled,
    update_rule,
)


def test_custom_rules_crud(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    assert list_rules(tmp_path) == []

    created = create_rule(
        tmp_path,
        {
            "name": "大额关联方",
            "description": "查关联方大额往来",
            "sql": "SELECT 1",
            "databaseId": "conn_1",
            "enabled": True,
        },
    )
    assert created["id"] == "R-0001"
    assert created["databaseId"] == "conn_1"

    set_enabled(tmp_path, "R-0001", False)
    after = {r["id"]: r for r in list_rules(tmp_path)}
    assert after["R-0001"]["enabled"] is False

    update_rule(tmp_path, "R-0001", {"description": "更新描述", "databaseId": None})
    after = {r["id"]: r for r in list_rules(tmp_path)}
    assert after["R-0001"]["description"] == "更新描述"
    assert after["R-0001"]["databaseId"] is None


def test_delete_rule(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    create_rule(tmp_path, {"name": "x", "sql": "SELECT 1"})
    from fireeyeaud_agent.store.rules import delete_rule

    delete_rule(tmp_path, "R-0001")
    assert list_rules(tmp_path) == []
