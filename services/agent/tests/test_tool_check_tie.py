from fireeyeaud_agent.store.duckdb import Database
from fireeyeaud_agent.tools.check_tie import check_tie


def _seed(tmp_path):
    fe = tmp_path / ".fireeye"
    fe.mkdir()
    db = Database(fe / "workspace.duckdb")
    db.create_table_from_rows(
        "src_ds1_bal",
        ["__row_id", "科目", "借方", "贷方"],
        [["1", "1001", "100.00", "30.00"], ["2", "1122", "50.00", "50.00"]],
    )
    db.close()


def test_check_tie_balanced(tmp_path):
    _seed(tmp_path)
    out = check_tie(
        tmp_path,
        {"table": "src_ds1_bal", "rules": [{"subject": "1001", "expected": "70.00"}]},
    )
    assert out["balanced"] is True
    assert out["diffs"] == []


def test_check_tie_detects_diff(tmp_path):
    _seed(tmp_path)
    out = check_tie(
        tmp_path,
        {"table": "src_ds1_bal", "rules": [{"subject": "1001", "expected": "99.00"}]},
    )
    assert out["balanced"] is False
    assert out["diffs"][0] == {
        "subject": "1001",
        "expected": "99.00",
        "actual": "70.00",
        "delta": "29.00",
    }
