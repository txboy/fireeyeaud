import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store.sandbox import validate_sql


def test_allows_select_and_with():
    validate_sql("SELECT 1")
    validate_sql("WITH t AS (SELECT 1) SELECT * FROM t")
    validate_sql("EXPLAIN SELECT 1")
    validate_sql("DESCRIBE t")


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
        # 新增：绕过面
        "SELECT * FROM read_csv('/etc/passwd')",
        "SELECT * FROM read_parquet('/tmp/x.parquet')",
        "SELECT * FROM read_text('/etc/passwd')",
        "SELECT setval('s', 1)",
        "SELECT * FROM t FOR UPDATE",
        "SELECT * INTO backup FROM t",
        "EXPLAIN ANALYZE SELECT 1",
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


def test_dialect_is_respected():
    # T-SQL 方括号标识符不应该被当成解析错误。
    validate_sql("SELECT [name] FROM [dbo].[users]", dialect="tsql")
