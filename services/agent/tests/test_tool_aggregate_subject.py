from fireeyeaud_agent.store.duckdb import Database
from fireeyeaud_agent.tools.aggregate_subject import aggregate_subject


def _seed(tmp_path):
    fe = tmp_path / ".fireeye"
    fe.mkdir()
    db = Database(fe / "workspace.duckdb")
    db.create_table_from_rows(
        "src_ds1_bal",
        ["__row_id", "科目", "借方", "贷方"],
        [
            ["1", "1001", "100.00", "0"],
            ["2", "1001", "0", "30.00"],
            ["3", "1122", "0", "50.00"],
        ],
    )
    db.close()


def test_aggregate(tmp_path):
    _seed(tmp_path)
    out = aggregate_subject(
        tmp_path,
        {
            "table": "src_ds1_bal",
            "subjectCol": "科目",
            "debitCol": "借方",
            "creditCol": "贷方",
        },
    )
    by = {s["code"]: s for s in out["subjects"]}
    assert by["1001"]["debit"] == "100.00"
    assert by["1001"]["credit"] == "30.00"
    assert by["1001"]["balance"] == "70.00"


def test_aggregate_subject_missing_table(tmp_path):
    fe = tmp_path / ".fireeye"
    fe.mkdir()
    Database(fe / "workspace.duckdb").close()
    out = aggregate_subject(
        tmp_path,
        {"table": "nope", "subjectCol": "a", "debitCol": "b", "creditCol": "c"},
    )
    assert out["subjects"] == []
