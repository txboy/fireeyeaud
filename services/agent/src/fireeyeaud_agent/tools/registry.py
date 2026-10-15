"""工具注册表：进程内 LangChain StructuredTool 绑定（Phase 1；MCP 封装推迟 Phase 6）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from .aggregate_subject import aggregate_subject
from .check_tie import check_tie
from .describe_source import describe_source
from .kb_search import kb_search
from .parse_ledger import parse_ledger
from .run_rule import run_rule
from .sql_query import sql_query
from .web_search import web_search

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


class KbSearchArgs(BaseModel):
    query: str = Field(description="检索查询文本")
    kbIds: list[str] | None = Field(
        default=None, description="限定的知识库 id（缺省用全部启用库）"
    )
    topK: int | None = Field(default=None, description="返回片段数上限")
    scoreThreshold: float | None = Field(default=None, description="相似度阈值")


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


class WebSearchArgs(BaseModel):
    query: str = Field(description="搜索查询")
    maxResults: int | None = Field(default=None, description="结果条数上限")


class RunRuleArgs(BaseModel):
    ruleId: str = Field(description="规则 id，如 R-0001")
    sourceId: str | None = Field(
        default=None, description="数据库连接 id；缺省用规则的默认数据库"
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
        "run_rule",
        "运行一条已保存的自定义 SQL 规则（返回查询结果行）。",
        run_rule,
        RunRuleArgs,
    ),
    (
        "kb_search",
        "检索已接入的知识库，返回归一化命中片段（依据审计准则/法规时使用）。",
        kb_search,
        KbSearchArgs,
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


def _context_wrapper(fn: ToolFn, context: dict[str, Any] | None) -> ToolFn:
    """把会话上下文（允许的连接 / 知识库 Provider）注入工具参数。

    `context is None` 表示不启用上下文（旧行为，不做限制）。
    """
    if not context:
        return fn

    def wrapped(root: Path, params: dict[str, Any]) -> dict[str, Any]:
        merged = dict(params)
        if fn in (sql_query, run_rule):
            if "allowedConnectionIds" in context:
                merged["allowedConnectionIds"] = context["allowedConnectionIds"]
            if fn is run_rule and "allowedRuleIds" in context:
                merged["allowedRuleIds"] = context["allowedRuleIds"]
        elif fn is kb_search and "allowedProviderIds" in context:
            merged["allowedProviderIds"] = context["allowedProviderIds"]
        return fn(root, merged)

    return wrapped


def build_tool_dict(
    root: Path | None = None, context: dict[str, Any] | None = None
) -> dict[str, ToolFn]:
    return {name: _context_wrapper(fn, context) for name, _desc, fn, _schema in _specs()}


def _web_enabled() -> bool:
    from ..store import app_settings

    return bool((app_settings.load().get("webSearch") or {}).get("enabled"))


def _specs() -> list[tuple[str, str, ToolFn, type[BaseModel]]]:
    specs = list(_SPECS)
    if _web_enabled():
        specs.append(
            (
                "web_search",
                "联网搜索（需在设置页开启）。",
                web_search,
                WebSearchArgs,
            )
        )
    return specs


def build_langchain_tools(
    root: Path, context: dict[str, Any] | None = None
) -> list[StructuredTool]:
    tools: list[StructuredTool] = []
    for name, desc, fn, schema in _specs():
        wrapped = _context_wrapper(fn, context)

        def _run(_fn: ToolFn = wrapped, _root: Path = root, **kwargs: Any) -> dict[str, Any]:
            return _fn(_root, kwargs)

        tools.append(
            StructuredTool.from_function(
                func=_run, name=name, description=desc, args_schema=schema
            )
        )
    return tools
