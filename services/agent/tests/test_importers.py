import pandas as pd

from fireeyeaud_agent.store.importers import read_table


def test_read_csv_strings(tmp_path):
    p = tmp_path / "a.csv"
    p.write_text("科目,借方\n1001,3200000.00\n", encoding="utf-8")
    cols, rows = read_table(p)
    assert cols == ["科目", "借方"]
    assert rows == [["1001", "3200000.00"]]


def test_read_xlsx_strings(tmp_path):
    p = tmp_path / "a.xlsx"
    pd.DataFrame({"科目": [1001], "借方": [3200000.00]}).to_excel(p, index=False)
    cols, rows = read_table(p)
    assert cols == ["科目", "借方"]
    assert rows[0][0] == "1001"


def test_read_csv_gbk_fallback(tmp_path):
    p = tmp_path / "b.csv"
    p.write_bytes("科目,借方\n1001,1.00\n".encode("gbk"))
    cols, rows = read_table(p)
    assert cols == ["科目", "借方"]
    assert rows == [["1001", "1.00"]]
