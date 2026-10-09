from fireeyeaud_agent.store.duckdb import Database
from fireeyeaud_agent.tools.parse_ledger import parse_ledger


def _seed(tmp_path, columns, rows):
    fe = tmp_path / ".fireeye"
    fe.mkdir()
    db = Database(fe / "workspace.duckdb")
    db.create_table_from_rows("src_ds1_jz", columns, rows)
    db.close()


def test_parse_ledger(tmp_path):
    _seed(
        tmp_path,
        ["__row_id", "凭证号", "日期", "摘要", "借方", "贷方", "科目"],
        [["1", "记-1", "2026-01-02", "采购", "100.00", "0", "1001"]],
    )
    out = parse_ledger(tmp_path, {"table": "src_ds1_jz"})
    v = out["vouchers"][0]
    assert v["voucherNo"] == "记-1"
    assert v["rowRef"] == "1"
    assert v["debit"] == "100.00"
    assert out["warnings"] == []


def test_parse_ledger_with_mapping_and_warning(tmp_path):
    _seed(tmp_path, ["__row_id", "no", "amt"], [["7", "J-9", "42.00"]])
    out = parse_ledger(
        tmp_path,
        {"table": "src_ds1_jz", "mapping": {"voucherNo": "no", "debit": "amt"}},
    )
    v = out["vouchers"][0]
    assert v["voucherNo"] == "J-9"
    assert v["debit"] == "42.00"
    assert v["date"] == ""
    assert any("date" in w for w in out["warnings"])
