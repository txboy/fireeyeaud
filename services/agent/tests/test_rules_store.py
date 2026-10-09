from fireeyeaud_agent.store.rules import (
    create_rule,
    list_rules,
    set_enabled,
    update_rule,
)


def test_builtin_and_custom_rules(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    rules = list_rules(tmp_path)
    ids = {r["id"] for r in rules}
    assert {"tie_check", "related_party_undisclosed"} <= ids
    builtin = next(r for r in rules if r["id"] == "tie_check")
    assert builtin["builtin"] is True and builtin["enabled"] is True

    created = create_rule(
        tmp_path,
        {
            "name": "大额关联方",
            "type": "sql",
            "severity": "high",
            "definition": "SELECT 1",
            "enabled": True,
        },
    )
    assert created["id"] == "R-0001"
    assert created["scope"] == "custom"

    set_enabled(tmp_path, "R-0001", False)
    after = {r["id"]: r for r in list_rules(tmp_path)}
    assert after["R-0001"]["enabled"] is False

    update_rule(tmp_path, "R-0001", {"severity": "medium"})
    after = {r["id"]: r for r in list_rules(tmp_path)}
    assert after["R-0001"]["severity"] == "medium"


def test_builtin_override(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    set_enabled(tmp_path, "tie_check", False)
    rules = {r["id"]: r for r in list_rules(tmp_path)}
    assert rules["tie_check"]["enabled"] is False
