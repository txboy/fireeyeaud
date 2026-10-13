import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store.duckdb import Database
from fireeyeaud_agent.store.rule_engine import run_rule
from fireeyeaud_agent.store.rules import create_rule


def _seed(tmp_path):
    fe = tmp_path / ".fireeye"
    (fe / "index").mkdir(parents=True)
    db = Database(fe / "workspace.duckdb")
    db.create_table_from_rows(
        "src_ds1_余额表",
        ["__row_id", "科目", "借方", "贷方"],
        [["1", "1001", "100", "0"], ["2", "1002", "0", "90"]],
    )
    db.close()


def test_run_sql_rule(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    _seed(tmp_path)
    rule = create_rule(
        {
            "name": "余额非零",
            "description": "查余额表全部行",
            "sql": "SELECT * FROM src_ds1_余额表",
            "scope": "project",
        },
        tmp_path,
    )
    result = run_rule(tmp_path, rule["id"])
    assert result["ruleId"] == rule["id"]
    assert result["rowCount"] == 2
    assert len(result["rows"]) == 2


def test_run_rule_not_found(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / ".fireeye").mkdir()
    with pytest.raises(ApiError):
        run_rule(tmp_path, "rule_9999")
