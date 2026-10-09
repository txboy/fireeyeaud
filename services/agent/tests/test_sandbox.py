import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store.sandbox import validate_sql


def test_allows_select_and_with():
    validate_sql("SELECT 1")
    validate_sql("WITH t AS (SELECT 1) SELECT * FROM t")
    validate_sql("EXPLAIN SELECT 1")


@pytest.mark.parametrize(
    "sql",
    [
        "ATTACH 'x.db'",
        "COPY t TO 'x.csv'",
        "INSTALL httpfs",
        "LOAD x",
        "EXPORT DATABASE 'x'",
        "PRAGMA database_list",
        "DROP TABLE t",
        "INSERT INTO t VALUES (1)",
        "SELECT 1; DROP TABLE t",
    ],
)
def test_rejects_dangerous(sql):
    with pytest.raises(ApiError) as exc:
        validate_sql(sql)
    assert exc.value.code == "E_SQL_REJECTED"


def test_rejects_empty():
    with pytest.raises(ApiError) as exc:
        validate_sql("   ")
    assert exc.value.code == "E_SQL_REJECTED"
