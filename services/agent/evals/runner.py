"""最小轨迹评测器：脚本化模型 + 临时工作区 + 事件断言。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator

from langchain_core.messages import AIMessageChunk

from fireeyeaud_agent.agent.graph import run_agent
from fireeyeaud_agent.store.duckdb import Database
from fireeyeaud_agent.store.index import save_schema

from .cases import EvalCase


@dataclass
class EvalResult:
    done: bool
    answer: str
    tools: list[str]
    events: list[dict[str, Any]]


class ScriptedModel:
    """按脚本产出工具调用或最终文本；每个脚本步骤只消费一次。"""

    def __init__(self, script: list[dict[str, Any]]) -> None:
        self._script = list(script)
        self.calls = 0

    def bind_tools(self, _tools: Any) -> "ScriptedModel":
        return self

    async def astream(self, _messages: Any) -> AsyncIterator[AIMessageChunk]:
        step = self._script[self.calls]
        self.calls += 1
        if "tool" in step:
            yield AIMessageChunk(
                content="",
                tool_calls=[
                    {
                        "name": step["tool"],
                        "args": step.get("args") or {},
                        "id": f"call_{self.calls}",
                    }
                ],
            )
        else:
            yield AIMessageChunk(content=str(step.get("text") or ""))


def _seed(root: Path, rows: list[list[str]]) -> None:
    fe = root / ".fireeye"
    (fe / "index").mkdir(parents=True, exist_ok=True)
    db = Database(fe / "workspace.duckdb")
    db.create_table_from_rows("src_ds1_x", ["__row_id", "a"], rows)
    db.close()
    save_schema(
        fe / "index" / "schema.json",
        [
            {
                "sourceId": "ds_1",
                "table": "src_ds1_x",
                "rowCount": len(rows),
                "headerRow": 1,
                "columns": [
                    {"name": "__row_id", "type": "string", "sample": "1"},
                    {"name": "a", "type": "string", "sample": "x"},
                ],
            }
        ],
    )


async def run_case(case: EvalCase) -> EvalResult:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _seed(root, case.seed_rows)
        model = ScriptedModel(case.script)
        events = [
            event
            async for event in run_agent(
                root,
                f"s_eval_{case.name}",
                case.question,
                "zh-CN",
                model=model,
            )
        ]

    tools: list[str] = []
    answer_parts: list[str] = []
    done = False
    for event in events:
        kind = event.get("type")
        data = event.get("data") or {}
        if kind == "tool_call":
            tools.append(str(data.get("tool") or ""))
        elif kind == "token":
            answer_parts.append(str(data.get("delta") or ""))
        elif kind == "done":
            done = True
    return EvalResult(
        done=done,
        answer="".join(answer_parts),
        tools=tools,
        events=events,
    )
