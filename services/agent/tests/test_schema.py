from fireeyeaud_agent.store.schema import infer_column, infer_type


def test_infer_types():
    assert infer_type("1001") == "string"
    assert infer_type("3200000.00") == "decimal"
    assert infer_type("-12.5") == "decimal"
    assert infer_type("2026-10-09") == "date"
    assert infer_type("") == "string"


def test_infer_column_decimal():
    col = infer_column("借方", ["100.00", "0", "30.50"])
    assert col == {"name": "借方", "type": "decimal", "sample": "100.00"}


def test_infer_column_mixed_is_string():
    col = infer_column("摘要", ["采购", "100.00"])
    assert col["type"] == "string"
