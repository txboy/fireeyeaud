"""工具注册表：进程内 LangChain StructuredTool 绑定（Phase 1；MCP 封装推迟 Phase 6）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from .aggregate_subject import aggregate_subject
from .check_tie import check_tie
from .describe_source import describe_source
from .parse_ledger import parse_ledger
from .sql_query import sql_query

ToolFn = Callable[[Path, dict[str, Any]], dict[str, Any]]


class DescribeSourceArgs(BaseModel):
    sourceId: str | None = Field(default=None, description="数据源 id，如 ds_1")
    table: str | None = Field(default=None, description="表名，如 src_ds1_序时账")


class SqlQueryArgs(BaseModel):
    sql: str = Field(description="只读 SQL（仅 SELECT/WITH/EXPLAIN/DESCRIBE）")
    limit: int | None = Field(default=200, description="返回行数上限")
    sourceId: str | None = Field(
        default=None, description="数据库数据源 id；缺省查询工作区 DuckDB"
    )


class ParseLedgerArgs(BaseModel):
    table: str = Field(description="原始表名")
    mapping: dict[str, str] | None = Field(default=None, description="字段→列名映射")


class AggregateSubjectArgs(BaseModel):
    table: str = Field(description="原始表名")
    subjectCol: str = Field(description="科目列")
    debitCol: str = Field(description="借方金额列")
    creditCol: str = Field(description="贷方金额列")
    nameCol: str | None = Field(default=None, description="科目名称列")


class CheckTieArgs(BaseModel):
    table: str = Field(description="原始表名")
    rules: list[dict[str, Any]] | None = Field(
        default=None, description="[{subject, expected}]；缺省做表级借贷平衡校验"
    )


_SPECS: list[tuple[str, str, ToolFn, type[BaseModel]]] = [
    (
        "describe_source",
        "查看工作区已导入数据源的表结构与列（构造 SQL 前先调用）。",
        describe_source,
        DescribeSourceArgs,
    ),
    (
        "sql_query",
        "对原始表执行只读 SQL 查询；仅允许 SELECT/WITH/EXPLAIN/DESCRIBE。",
        sql_query,
        SqlQueryArgs,
    ),
    (
        "parse_ledger",
        "把记账凭证表解析为标准凭证行（凭证号/日期/摘要/借贷/科目）。",
        parse_ledger,
        ParseLedgerArgs,
    ),
    (
        "aggregate_subject",
        "按科目汇总借方、贷方与余额。",
        aggregate_subject,
        AggregateSubjectArgs,
    ),
    (
        "check_tie",
        "校验科目余额勾稽或表级借贷平衡，返回差异明细。",
        check_tie,
        CheckTieArgs,
    ),
]


def build_tool_dict() -> dict[str, ToolFn]:
    return {name: fn for name, _desc, fn, _schema in _SPECS}


def build_langchain_tools(root: Path) -> list[StructuredTool]:
    tools: list[StructuredTool] = []
    for name, desc, fn, schema in _SPECS:

        def _run(_fn: ToolFn = fn, _root: Path = root, **kwargs: Any) -> dict[str, Any]:
            return _fn(_root, kwargs)

        tools.append(
            StructuredTool.from_function(
                func=_run, name=name, description=desc, args_schema=schema
            )
        )
    return tools
