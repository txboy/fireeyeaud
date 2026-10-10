from fireeyeaud_agent.store import authorization


def test_authorization_roundtrip(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    assert authorization.get(tmp_path, "conn_1") == {}
    authorization.set_entry(
        tmp_path,
        "conn_1",
        {"customers": ["id", "name"], "orders": ["*"]},
    )
    assert authorization.get(tmp_path, "conn_1") == {
        "customers": ["id", "name"],
        "orders": ["*"],
    }


def test_is_table_allowed(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    authorization.set_entry(tmp_path, "conn_1", {"customers": ["id"]})
    assert authorization.table_allowed(tmp_path, "conn_1", "customers") is True
    assert authorization.table_allowed(tmp_path, "conn_1", "orders") is False


def test_column_allowed(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    authorization.set_entry(tmp_path, "conn_1", {"customers": ["id", "name"]})
    assert authorization.column_allowed(tmp_path, "conn_1", "customers", "name") is True
    assert (
        authorization.column_allowed(tmp_path, "conn_1", "customers", "secret") is False
    )
    authorization.set_entry(tmp_path, "conn_1", {"customers": ["*"]})
    assert (
        authorization.column_allowed(tmp_path, "conn_1", "customers", "secret") is True
    )
