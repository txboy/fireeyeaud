from fireeyeaud_agent.store.duckdb import Database
from fireeyeaud_agent.store.rule_engine import run_all_rules, run_rule
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


def test_run_sql_rule_dry_run(tmp_path):
    _seed(tmp_path)
    rule = create_rule(
        tmp_path,
        {
            "name": "余额非零",
            "type": "sql",
            "severity": "medium",
            "definition": "SELECT * FROM src_ds1_余额表",
        },
    )
    preview = run_rule(tmp_path, rule["id"])
    assert preview["rowCount"] == 2
    assert len(preview["rows"]) == 2


def test_run_all_creates_findings(tmp_path):
    _seed(tmp_path)
    create_rule(
        tmp_path,
        {
            "name": "余额非零",
            "type": "sql",
            "severity": "medium",
            "definition": "SELECT * FROM src_ds1_余额表",
        },
    )
    result = run_all_rules(tmp_path)
    assert result["count"] >= 2
    from fireeyeaud_agent.store.findings import load_findings

    assert any(f["origin"] == "rule" for f in load_findings(tmp_path))
