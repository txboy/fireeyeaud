"""SQL 只读沙箱（设计 §17.3）。

从「首词 + 关键词正则」升级为 sqlglot AST 校验：
- 只允许单条 SELECT / WITH / DESCRIBE；
- EXPLAIN 允许，但 EXPLAIN ANALYZE 拒绝（会真正执行）；
- 拒绝 FOR UPDATE / SELECT INTO；
- 拒绝可读写文件或产生副作用的函数（read_csv / setval ...）。
"""

from __future__ import annotations

import sqlglot
from sqlglot import exp

from ..errors import ApiError

_DIALECT_ALIASES = {
    "postgresql": "postgres",
    "mssql": "tsql",
    "access": "tsql",
}
_ALLOWED_DIALECTS = {
    "duckdb",
    "sqlite",
    "postgres",
    "mysql",
    "tsql",
    "oracle",
}
# 这些函数要么能读工作区外的文件，要么会在数据库里产生副作用。
_FORBIDDEN_FUNCS = {
    "read_csv",
    "read_csv_auto",
    "read_parquet",
    "read_json",
    "read_json_auto",
    "read_text",
    "glob",
    "sniff_csv",
    "parquet_scan",
    "csv_scan",
    "setval",
    "pg_terminate_backend",
    "pg_cancel_backend",
    "pg_sleep",
    "dblink",
    "lo_export",
    "lo_import",
    "xp_cmdshell",
}


def _reject(reason: str) -> None:
    raise ApiError("E_SQL_REJECTED", 400, "error.sqlRejected", {"reason": reason})


def _dialect(name: str | None) -> str:
    key = (name or "duckdb").lower()
    key = _DIALECT_ALIASES.get(key, key)
    return key if key in _ALLOWED_DIALECTS else "duckdb"


def _func_name(node: exp.Func) -> str:
    if isinstance(node, exp.Anonymous):
        return str(node.this or "").lower()
    return str(node.sql_name() or "").lower()


def validate_sql(sql: str, dialect: str | None = None) -> str:
    text = (sql or "").strip().rstrip(";").strip()
    if not text:
        _reject("empty")
    if ";" in text:
        _reject("multiple_statements")

    first = text.split(None, 1)[0].lower()
    body = text
    if first == "explain":
        rest = text[len("explain") :].strip()
        if rest.lower().startswith("analyze"):
            _reject("explain_analyze")
        body = rest
    elif first in ("describe", "desc"):
        # DESCRIBE 只读元数据，且 sqlglot 对各方言支持不一致，直接放行。
        return text

    try:
        statements = [s for s in sqlglot.parse(body, read=_dialect(dialect)) if s]
    except Exception as exc:  # 解析失败按拒绝处理，避免“看不懂就放行”
        _reject(f"parse_error: {exc}")

    if len(statements) != 1:
        _reject("multiple_statements")
    tree = statements[0]
    if not isinstance(tree, (exp.Select, exp.Describe)):
        _reject("not_readonly")
    if isinstance(tree, exp.Select):
        if tree.args.get("locks"):
            _reject("for_update")
        if tree.args.get("into") is not None:
            _reject("select_into")
    for node in tree.walk():
        if isinstance(node, exp.Func):
            name = _func_name(node)
            if name in _FORBIDDEN_FUNCS:
                _reject(f"forbidden_function: {name}")
    return text
