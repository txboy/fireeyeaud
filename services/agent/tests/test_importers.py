import pandas as pd
import pytest

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


def test_read_txt_rejected(tmp_path):
    """纯文本不是表格：不再按 CSV 解析。"""
    p = tmp_path / "notes.txt"
    p.write_text("这是一份纯文本测试文件。\n第二行\n", encoding="utf-8")
    with pytest.raises(ValueError, match="unsupported file type"):
        read_table(p)
