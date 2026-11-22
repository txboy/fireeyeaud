"""确定性轨迹用例：用脚本化模型回放一次工具链，断言工具顺序与最终答复。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class EvalCase:
    name: str
    question: str
    seed_rows: list[list[str]]
    script: list[dict[str, Any]] = field(default_factory=list)
    expect_tools: list[str] = field(default_factory=list)
    expect_answer_contains: list[str] = field(default_factory=list)


CASES = [
    EvalCase(
        name="sql_query_path",
        question="统计 a 列的记录数",
        seed_rows=[["1", "x"], ["2", "y"], ["3", "z"]],
        script=[
            {
                "tool": "sql_query",
                "args": {"sql": "SELECT count(*) AS n FROM src_ds1_x"},
            },
            {"text": "共有 3 条记录。"},
        ],
        expect_tools=["sql_query"],
        expect_answer_contains=["3"],
    ),
    EvalCase(
        name="describe_before_query",
        question="先看结构再查 a 列",
        seed_rows=[["1", "x"], ["2", "y"]],
        script=[
            {"tool": "describe_source", "args": {"table": "src_ds1_x"}},
            {"tool": "sql_query", "args": {"sql": "SELECT a FROM src_ds1_x"}},
            {"text": "a 列共有 2 个值。"},
        ],
        expect_tools=["describe_source", "sql_query"],
        expect_answer_contains=["2"],
    ),
    EvalCase(
        name="tool_error_recovery",
        question="查一个不存在的表",
        seed_rows=[["1", "x"]],
        script=[
            {"tool": "sql_query", "args": {"sql": "SELECT * FROM src_ds1_missing"}},
            {"text": "该表不存在，请确认数据源。"},
        ],
        expect_tools=["sql_query"],
        expect_answer_contains=["不存在"],
    ),
]
