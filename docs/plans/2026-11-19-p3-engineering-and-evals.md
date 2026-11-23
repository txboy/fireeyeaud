# P3 工程化与可观测性 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把「能跑」升级为「可回归、可度量、可排障」：PR 合并前有质量门禁，证据链追加不再随审计轮次变慢，四套对话循环共用一个流式内核，并有一套可回放的轨迹评测。

**Architecture:** 新增 `ci.yml` 在 PR 上跑 pytest / ruff / typecheck / 前端测试；`jsonl.py` 增加尾部读取，把 `append_event` 的 seq 与哈希链前驱查询从 O(n) 降到 O(1)；新增 `agent/streaming.py` 统一「流式 + 超时 + 重试 + usage」，并用守卫测试禁止其他模块直接 `astream`；新增 `evals/` 与 `tests/test_evals.py` 把关键审计路径变成确定性回放用例；LLM 请求日志改为显式开关。

**Tech Stack:** Python 3.12、pytest/pytest-asyncio、ruff、GitHub Actions、Node 24、TypeScript、DuckDB。

---

## 背景与范围

对应评审中的 P3 项：

1. CI 只构建 + `/health` 冒烟，不跑 pytest / ruff / typecheck（`.github/workflows/release.yml`）。
2. 证据链每次追加都全量读 `evidence.jsonl`，整体 O(n²)（`store/evidence.py:32-35,85`、`store/jsonl.py:27-29`）。
3. `graph` / `doc_chat` / `sql_assistant` / `attachment_reader` 各自实现流式调用，超时与重试语义不一致。
4. 缺少轨迹级评测，换模型/改提示词/改压缩策略无法量化回归。
5. 每步打印完整 messages 与响应，包含 SQL、表名与数据样本（`agent/graph.py:422,535`）。
6. README 的安全承诺需要与 P0/P2 的实际行为对齐。

**不在本计划内**：字段级授权与 `SELECT *` 展开（独立安全事项）；把 `graph.py` 整体重写成通用 harness（本计划只统一流式内核，工具循环保持各自入口）。

**前置依赖**：P0、P1、P2 计划已合入。文中引用 P1 的 `agent/retry.py`、`agent/tool_calls.py` 与 P2 的 `agent/tool_output.py`。

---

### Task 1: PR 质量门禁

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`（在「开发」章节补一行门禁命令说明）

**Step 1: 先记录本地基线**

```bash
cd E:/fireeyeaud
npm run agent:lint
npm run agent:test
npm run renderer:typecheck
npm run desktop:test
```

Expected: 明确当前哪些命令是绿的、哪些需要先修。若 `agent:lint` 或 `agent:test` 已有失败，先在本任务里单独提交修复（`fix: make quality gate pass`），否则 CI 一上线就是红的。

**Step 2: 新建工作流**

```yaml
name: ci

on:
  pull_request:
  push:
    branches:
      - main

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  agent:
    # 与开发机一致：pyodbc / access-parser 在 Windows 上最稳。
    runs-on: windows-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: services/agent
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - uses: astral-sh/setup-uv@v5

      - name: Install
        run: uv sync --dev

      - name: Lint
        run: uv run ruff check .

      - name: Test
        run: uv run pytest tests

  web:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install
        run: npm ci --no-audit --no-fund

      - name: Typecheck renderer
        run: npm run renderer:typecheck

      - name: Test renderer
        run: npm run test -w @fireeyeaud/renderer

      - name: Test desktop
        run: npm run desktop:test

      - name: Build renderer
        run: npm run renderer:build
```

**Step 3: 本地验证工作流语法**

```bash
cd E:/fireeyeaud
npx --yes yaml-lint .github/workflows/ci.yml
```

Expected: `Valid YAML`（或工具无输出、退出码 0）。若 `yaml-lint` 不可用，用 Python 校验：

```bash
python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml',encoding='utf-8')); print('ok')"
```

Expected: `ok`。

**Step 4: 用 PR 验证门禁**

推一个只改注释的分支并发起 PR，确认 `agent` 与 `web` 两个 job 都跑绿。

Expected: 两个 job 成功；故意改坏一处格式（如加未使用 import）再推，确认 `agent` job 变红后再还原。

**Step 5: 提交**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: run agent tests, ruff and renderer checks on pull requests"
```

---

### Task 2: 证据链追加降为 O(1)

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/jsonl.py`
- Modify: `services/agent/src/fireeyeaud_agent/store/evidence.py:32-35,59,85,100`
- Test: `services/agent/tests/test_jsonl.py`
- Test: `services/agent/tests/test_evidence_store.py`

**Step 1: 写失败测试**

在 `tests/test_jsonl.py` 追加：

```python
import json

from fireeyeaud_agent.store import jsonl


def _write_lines(path, count):
    with path.open("w", encoding="utf-8") as fh:
        for i in range(1, count + 1):
            fh.write(json.dumps({"seq": i, "hash": f"h{i}"}) + "\n")


def test_last_event_reads_tail_only(tmp_path):
    path = tmp_path / "events.jsonl"
    _write_lines(path, 50_000)
    assert jsonl.last_event(path) == {"seq": 50_000, "hash": "h50000"}


def test_last_event_ignores_partial_trailing_line(tmp_path):
    path = tmp_path / "events.jsonl"
    _write_lines(path, 3)
    with path.open("a", encoding="utf-8") as fh:
        fh.write('{"seq": 4, "ha')
    assert jsonl.last_event(path) == {"seq": 3, "hash": "h3"}


def test_last_event_empty_and_missing(tmp_path):
    assert jsonl.last_event(tmp_path / "nope.jsonl") is None
    empty = tmp_path / "empty.jsonl"
    empty.write_text("", encoding="utf-8")
    assert jsonl.last_event(empty) is None
```

在 `tests/test_evidence_store.py` 追加：

```python
def test_append_does_not_full_scan(monkeypatch, tmp_path):
    from fireeyeaud_agent.store import evidence as evidence_store
    from fireeyeaud_agent.store import jsonl

    def _boom(*_a, **_k):
        raise AssertionError("append path must not read the whole JSONL")

    monkeypatch.setattr(jsonl, "read_events", _boom)
    monkeypatch.setattr(evidence_store, "read_events", _boom)

    for i in range(5):
        evidence_store.append_evidence(
            tmp_path,
            session_id="s_1",
            step="tool_result",
            tool="sql_query",
            params={"sql": "SELECT 1"},
            result_summary=f"{i} 行",
            result={"rowCount": i},
            lang="zh-CN",
        )

    events = jsonl.read_events(evidence_store.evidence_path(tmp_path))
    assert [e["seq"] for e in events] == [1, 2, 3, 4, 5]
    assert events[0]["prevHash"] == ""
    for prev, cur in zip(events, events[1:]):
        assert cur["prevHash"] == prev["hash"]
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_jsonl.py tests/test_evidence_store.py -k "last_event or full_scan" -v
```

Expected: FAIL，`last_event` 不存在。

**Step 3: 实现尾部读取**

`store/jsonl.py`：

```python
_TAIL_CHUNK = 64 * 1024


def last_event(path: Path) -> dict[str, Any] | None:
    """从文件尾增量读取最后一个完整事件。

    追加路径只需要 seq 与 prevHash，不应为了这两项读完整份 JSONL。
    """
    if not path.exists():
        return None
    with open(path, "rb") as fh:
        fh.seek(0, os.SEEK_END)
        pos = fh.tell()
        buf = b""
        while pos > 0:
            step = min(_TAIL_CHUNK, pos)
            pos -= step
            fh.seek(pos)
            buf = fh.read(step) + buf
            text = buf.decode("utf-8", errors="replace")
            lines = [line for line in text.split("\n") if line.strip()]
            for line in reversed(lines):
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    # 崩溃留下的半行：跳过，继续找上一条完整事件。
                    continue
            if pos == 0:
                return None
    return None


def next_seq(path: Path) -> int:
    last = last_event(path)
    return int(last.get("seq", 0)) + 1 if last else 1
```

`append_event` 增加可选 `seq`，避免调用方已经算过又被重算：

```python
def append_event(
    path: Path, event: dict[str, Any], *, seq: int | None = None
) -> dict[str, Any]:
    """按 seq 顺序原子追加（追加写 + flush + fsync），返回最终事件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    if seq is None:
        seq = next_seq(path)
    record = {"seq": seq, **event}
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(line)
        fh.flush()
        os.fsync(fh.fileno())
    return record
```

**Step 4: 让 evidence 只读一次尾部**

`store/evidence.py`：

```python
from .jsonl import append_event, last_event, read_events
```

删除 `_prev_hash`，改为：

```python
def _tail(path: Path) -> tuple[int, str]:
    """返回下一条 seq 与当前的链头哈希。"""
    last = last_event(path)
    if not last:
        return 1, ""
    return int(last.get("seq", 0)) + 1, str(last.get("hash", ""))
```

`append_evidence` 开头：

```python
    root = Path(root)
    path = evidence_path(root)
    seq, prev_hash = _tail(path)
    ev_id = f"ev_{seq}"
```

把 `"prevHash": _prev_hash(path),` 改为 `"prevHash": prev_hash,`，结尾改为：

```python
    event["hash"] = compute_hash(event["prevHash"], event)
    return append_event(path, event, seq=seq)
```

**Step 5: 运行测试**

```bash
cd services/agent
uv run pytest tests/test_jsonl.py tests/test_evidence_store.py tests/test_evidence_api.py tests/test_agent_evidence.py -v
```

Expected: PASS，且哈希链校验测试仍通过。

**Step 6: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/store/jsonl.py \
        services/agent/src/fireeyeaud_agent/store/evidence.py \
        services/agent/tests/test_jsonl.py \
        services/agent/tests/test_evidence_store.py
git commit -m "perf(evidence): append events in O(1) via tail reads"
```

---

### Task 3: 抽出共享流式内核

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/agent/streaming.py`
- Modify: `services/agent/src/fireeyeaud_agent/agent/graph.py:423-432`
- Modify: `services/agent/src/fireeyeaud_agent/agent/doc_chat.py:38-47`
- Modify: `services/agent/src/fireeyeaud_agent/agent/sql_assistant.py:744-765`
- Test: `services/agent/tests/test_streaming.py`（新建）
- Test: `services/agent/tests/test_no_raw_astream.py`（新建）

**Step 1: 写失败测试**

```python
import asyncio

import pytest
from langchain_core.messages import AIMessageChunk

from fireeyeaud_agent.agent.streaming import StreamCollector, iter_model
from fireeyeaud_agent.config.settings import settings


class _Model:
    def __init__(self, script):
        self.script = list(script)
        self.calls = 0

    async def astream(self, _messages):
        step = self.script[self.calls]
        self.calls += 1
        if isinstance(step, Exception):
            raise step
        for piece in step:
            yield AIMessageChunk(
                content=piece,
                usage_metadata={
                    "input_tokens": 10,
                    "output_tokens": 1,
                    "total_tokens": 11,
                    "input_token_details": {"cache_read": 4},
                },
            )


@pytest.mark.asyncio
async def test_collects_text_ai_and_usage():
    collector = StreamCollector()
    model = _Model([["你", "好"]])
    pieces = [
        piece
        async for piece in iter_model(
            model, [], timeout_seconds=1, collector=collector
        )
    ]
    assert pieces == ["你", "好"]
    assert collector.ai.content == "你好"
    assert collector.usage["promptTokens"] == 10
    assert collector.usage["cachedTokens"] == 4


@pytest.mark.asyncio
async def test_timeout_raises():
    class _Hang:
        async def astream(self, _messages):
            await asyncio.sleep(5)
            yield AIMessageChunk(content="x")

    collector = StreamCollector()
    with pytest.raises(TimeoutError):
        async for _ in iter_model(
            _Hang(), [], timeout_seconds=0.05, collector=collector
        ):
            pass


@pytest.mark.asyncio
async def test_transient_error_is_retried(monkeypatch):
    monkeypatch.setattr(settings, "llm_retry_base_seconds", 0)
    monkeypatch.setattr(settings, "llm_max_attempts", 3)
    collector = StreamCollector()
    model = _Model([ConnectionError("connection reset"), ["好"]])
    pieces = [
        piece
        async for piece in iter_model(
            model, [], timeout_seconds=1, collector=collector
        )
    ]
    assert pieces == ["好"]
    assert model.calls == 2


@pytest.mark.asyncio
async def test_partial_output_is_not_retried(monkeypatch):
    monkeypatch.setattr(settings, "llm_retry_base_seconds", 0)
    monkeypatch.setattr(settings, "llm_max_attempts", 3)

    class _Partial:
        calls = 0

        async def astream(self, _messages):
            _Partial.calls += 1
            yield AIMessageChunk(content="部分")
            raise ConnectionError("connection reset")

    collector = StreamCollector()
    with pytest.raises(ConnectionError):
        async for _ in iter_model(
            _Partial(), [], timeout_seconds=1, collector=collector
        ):
            pass
    assert _Partial.calls == 1
```

守卫测试：

```python
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "fireeyeaud_agent"
_ALLOWED = {
    Path("agent/streaming.py"),
    Path("agent/attachment_reader.py"),  # 视觉转写独立超时，后续再迁移
}


def test_only_streaming_module_calls_astream():
    offenders = []
    for path in SRC.rglob("*.py"):
        rel = path.relative_to(SRC)
        if rel in _ALLOWED:
            continue
        if ".astream(" in path.read_text(encoding="utf-8"):
            offenders.append(str(rel))
    assert not offenders, f"use agent.streaming.iter_model instead: {offenders}"
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_streaming.py tests/test_no_raw_astream.py -v
```

Expected: FAIL，`streaming` 模块不存在，且守卫测试列出 `graph.py`、`doc_chat.py`、`sql_assistant.py`。

**Step 3: 实现 streaming.py**

```python
"""共享流式内核：超时、瞬时错误重试、usage 累计与 AI 消息合并。

所有对话入口（主对话、报告/取证单、SQL 助手）都走这里，
避免四套循环各自演化出不同的超时与重试语义。
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from langchain_core.messages import BaseMessage

from ..config.settings import settings
from .retry import is_retryable, retry_delay


@dataclass
class StreamCollector:
    ai: Any = None
    usage: dict[str, int] = field(default_factory=dict)
    emitted: bool = False


@asynccontextmanager
async def _maybe_timeout(seconds: float | None):
    if seconds and seconds > 0:
        async with asyncio.timeout(float(seconds)):
            yield
    else:
        yield


def _merge_usage(collector: StreamCollector, chunk: Any) -> None:
    usage = getattr(chunk, "usage_metadata", None)
    if not usage:
        return
    collector.usage["promptTokens"] = int(usage.get("input_tokens") or 0)
    collector.usage["completionTokens"] = int(usage.get("output_tokens") or 0)
    details = usage.get("input_token_details") or {}
    collector.usage["cachedTokens"] = int(details.get("cache_read") or 0)


async def iter_model(
    bound: Any,
    messages: list[BaseMessage],
    *,
    timeout_seconds: float | None,
    collector: StreamCollector,
    retry: bool = True,
    max_attempts: int | None = None,
) -> AsyncIterator[str]:
    """流式产出文本 delta；结束时 `collector.ai` 为合并后的消息。

    仅在「尚未产出任何正文」时重试，避免把已展示给用户的内容重复一遍。
    """
    attempts_limit = int(max_attempts or settings.llm_max_attempts)
    attempt = 0
    while True:
        attempt += 1
        collector.ai = None
        collector.emitted = False
        try:
            async with _maybe_timeout(timeout_seconds):
                async for chunk in bound.astream(messages):
                    collector.ai = (
                        chunk if collector.ai is None else collector.ai + chunk
                    )
                    _merge_usage(collector, chunk)
                    piece = chunk.content
                    if isinstance(piece, str) and piece:
                        collector.emitted = True
                        yield piece
            return
        except Exception as exc:
            if (
                not retry
                or collector.emitted
                or attempt >= attempts_limit
                or not is_retryable(exc)
            ):
                raise
            await asyncio.sleep(
                retry_delay(attempt, base=settings.llm_retry_base_seconds)
            )
```

**Step 4: 改造 graph.py**

把 P1 的 `_stream_model` 删除，改为：

```python
            try:
                # 整轮超时在外层，单步不重复计时，避免重试把总时长翻倍。
                async with asyncio.timeout(settings.turn_timeout_seconds):
                    collector = StreamCollector()
                    async for piece in iter_model(
                        bound,
                        messages,
                        timeout_seconds=None,
                        collector=collector,
                    ):
                        yield event("token", {"delta": piece})
            except TimeoutError:
                ...  # 保持现有 E_LLM_TIMEOUT 分支
            except Exception as exc:
                ...  # 保持现有溢出 / E_LLM_UNAVAILABLE 分支

            ai = collector.ai
```

并把 P2 里内联的 usage 累计删掉，`_usage()` 改为读取 `collector.usage`：

```python
        def _usage() -> dict[str, Any]:
            data: dict[str, Any] = {
                "tokensEstimated": estimate_messages_tokens(messages),
                "contextWindow": resolve_context_window(
                    profile, default=settings.default_context_window
                ),
            }
            if usage_actual:
                data.update(usage_actual)
                data["tokensMeasured"] = True
            return data
```

> 若 P2 已实现 `usage_actual`，把 `usage_actual` 的值改为来自 `collector.usage`（`usage_actual.update(collector.usage)`）；不要同时保留两套累计逻辑。

**Step 5: 改造 doc_chat.py**

```python
from .streaming import StreamCollector, iter_model
from ..config.settings import settings

    for _step in range(max_steps):
        collector = StreamCollector()
        async for piece in iter_model(
            bound,
            messages,
            timeout_seconds=settings.turn_timeout_seconds,
            collector=collector,
        ):
            yield {"event": "delta", "data": {"text": piece}}
        merged = collector.ai
        if merged is None:
            break
```

**Step 6: 改造 sql_assistant.py**

```python
from .streaming import StreamCollector, iter_model

        for round_index in range(MAX_TOOL_ROUNDS + 1):
            collector = StreamCollector()
            async for delta in iter_model(
                bound,
                messages,
                timeout_seconds=settings.turn_timeout_seconds,
                collector=collector,
            ):
                streamed_any = True
                yield emit("token", {"delta": delta})

            ai = collector.ai
            tool_calls = list(getattr(ai, "tool_calls", []) or []) if ai is not None else []
```

同文件 `MAX_TOOL_ROUNDS` 用尽后的最终答复也改为 `iter_model(chat, messages, ...)`，不要直接 `chat.astream`。

**Step 7: 运行测试**

```bash
cd services/agent
uv run pytest tests/test_streaming.py tests/test_no_raw_astream.py \
              tests/test_agent_graph.py tests/test_report_agent_tools.py \
              tests/test_form_agent.py tests/test_db_sql_assistant.py -v
```

Expected: PASS。SQL 助手既有测试若断言 token 事件数量，确认重试关闭时数量不变。

**Step 8: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/agent/streaming.py \
        services/agent/src/fireeyeaud_agent/agent/graph.py \
        services/agent/src/fireeyeaud_agent/agent/doc_chat.py \
        services/agent/src/fireeyeaud_agent/agent/sql_assistant.py \
        services/agent/tests/test_streaming.py \
        services/agent/tests/test_no_raw_astream.py
git commit -m "refactor(agent): share one streaming kernel across chat loops"
```

---

### Task 4: 轨迹级评测

**Files:**
- Create: `services/agent/evals/__init__.py`
- Create: `services/agent/evals/cases.py`
- Create: `services/agent/evals/runner.py`
- Create: `services/agent/tests/test_evals.py`

**Step 1: 写失败测试**

```python
import pytest

from evals.cases import CASES
from evals.runner import run_case


@pytest.mark.parametrize("case", CASES, ids=[c.name for c in CASES])
async def test_eval_case(case):
    result = await run_case(case)
    assert result.done, "agent did not finish with done"
    assert result.tools == case.expect_tools
    for needle in case.expect_answer_contains:
        assert needle in result.answer
    assert result.answer != ""
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_evals.py -v
```

Expected: FAIL，`evals` 包不存在。

**Step 3: 定义用例**

`evals/cases.py`：

```python
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
```

**Step 4: 实现 runner**

`evals/runner.py`：

```python
"""最小轨迹评测器：脚本化模型 + 临时工作区 + 事件断言。"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator

from langchain_core.messages import AIMessageChunk

from fireeyeaud_agent.agent.graph import run_agent
from fireeyeaud_agent.store.duckdb import Database

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
    fe.mkdir(parents=True, exist_ok=True)
    db = Database(fe / "workspace.duckdb")
    db.create_table_from_rows(
        "src_ds1_x", ["__row_id", "a"], rows
    )
    db.close()


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
```

`evals/__init__.py`：空文件，仅让 `evals` 成为包。

若 `pytest` 从仓库根跑导致 `evals` 无法导入，在 `services/agent/tests/conftest.py` 追加（没有就新建）：

```python
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
```

**Step 5: 运行评测**

```bash
cd services/agent
uv run pytest tests/test_evals.py -v
```

Expected: 3 个用例 PASS。若 `describe_before_query` 因 `describe_source` 需要导入数据源而失败，检查 `_seed` 是否还需写 `datasources.json`；必要时复用 `tests/test_tool_describe_source.py` 里的夹具写法。

**Step 6: 接入 CI**

在 `.github/workflows/ci.yml` 的 `agent` job 里，把 Test 步骤改为：

```yaml
      - name: Test
        run: uv run pytest tests
```

（`tests/test_evals.py` 已在 `tests/` 内，无需 additional step。）

**Step 7: 提交**

```bash
git add services/agent/evals services/agent/tests/test_evals.py services/agent/tests/conftest.py
git commit -m "test(agent): add deterministic trajectory evals"
```

---

### Task 5: LLM 日志默认关闭

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/config/settings.py`
- Modify: `services/agent/src/fireeyeaud_agent/agent/graph.py:420-423,535`
- Test: `services/agent/tests/test_llm_log.py`

**Step 1: 写失败测试**

在 `tests/test_llm_log.py` 追加：

```python
def test_llm_log_is_silent_by_default(capsys, monkeypatch):
    from fireeyeaud_agent.agent.graph import log_llm
    from fireeyeaud_agent.config.settings import settings

    monkeypatch.setattr(settings, "llm_debug_log", False)
    log_llm("===== secret sql: SELECT * FROM salary =====")
    assert capsys.readouterr().out == ""


def test_llm_log_prints_when_enabled(capsys, monkeypatch):
    from fireeyeaud_agent.agent.graph import log_llm
    from fireeyeaud_agent.config.settings import settings

    monkeypatch.setattr(settings, "llm_debug_log", True)
    log_llm("hello")
    assert "hello" in capsys.readouterr().out
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_llm_log.py -k log_is -v
```

Expected: FAIL，`log_llm` 不存在。

**Step 3: 加开关与 helper**

`config/settings.py`：

```python
    # 把每一步完整的 LLM 请求/响应打到 sidecar 控制台；默认关闭（含 SQL 与数据样本）。
    llm_debug_log: bool = False
```

`agent/graph.py`：

```python
def log_llm(text: str) -> None:
    if settings.llm_debug_log:
        print(text, flush=True)
```

把三处 `print(format_llm_request(...), flush=True)` / `print(format_llm_response(...), flush=True)` 改为 `log_llm(...)`。保留异常与耗时日志（它们不含完整 messages）。

**Step 4: 运行测试**

```bash
cd services/agent
uv run pytest tests/test_llm_log.py tests/test_agent_graph.py tests/test_chat_sse.py -v
```

Expected: PASS，SSE 测试不依赖控制台输出。

**Step 5: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/config/settings.py \
        services/agent/src/fireeyeaud_agent/agent/graph.py \
        services/agent/tests/test_llm_log.py
git commit -m "chore(agent): gate verbose LLM logging behind an env flag"
```

---

### Task 6: 文档与安全承诺同步

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`（若不存在，跳过并在 README 说明）

**Step 1: 对照实际行为列出差异**

逐条核对并记录结论：

- SQL 只读现在是 AST + 引擎级，不再是「正则」。
- DuckDB 已关闭外部文件访问，`read_csv` 类查询会被拒绝。
- 外部库连接使用只读事务（PG/MySQL/Oracle）。
- MCP 写工具默认拒绝，需 `permissions.allowWrite=true`。
- 大结果会落 `.fireeye/artifacts/`，模型通过 `read_artifact` 回读。

**Step 2: 更新 README**

把「安全边界」段落改为与实际一致的表述，例如：

```markdown
- SQL 查询在引擎层强制只读：AST 校验只允许 SELECT/WITH/DESCRIBE，
  并拒绝 `read_csv`/`read_parquet` 等文件函数与 `EXPLAIN ANALYZE`；
  工作区 DuckDB 关闭外部文件访问，外部数据库使用只读事务。
- 工具结果超过上下文预算时写入 `.fireeye/artifacts/`，
  模型只能通过 `read_artifact` 按页回读，不会把整份数据塞进上下文。
- MCP 工具默认只暴露只读工具；写工具需要在 Server 配置中显式开启
  `permissions.allowWrite`。
```

同时删除或限定旧的「正则拦截」「AI 没有写文件的工具」等绝对化表述，注明 MCP 的例外。

**Step 3: 检查文档链接与命令**

```bash
cd E:/fireeyeaud
npm run agent:test -- --collect-only -q
```

Expected: 收集成功，无导入错误；README 里引用的脚本名与 `package.json` 一致。

**Step 4: 提交**

```bash
git add README.md docs/architecture.md
git commit -m "docs: align security claims with enforced read-only behavior"
```

---

## 验收清单

- [ ] PR 上 `ci` 的 `agent` / `web` 两个 job 均为必需检查，`main` 合并前必须绿。
- [ ] `ruff check .` 与 `pytest tests` 在 CI 与本机行为一致。
- [ ] 追加 1 万条证据事件的耗时与事件总数近似无关；追加路径不再调用 `read_events`。
- [ ] 哈希链仍逐条可验证，`prevHash` 与上一条 `hash` 一致。
- [ ] 只有 `agent/streaming.py` 与 `attachment_reader.py` 直接调用 `astream`。
- [ ] 主对话、报告/取证单、SQL 助手共用同一超时/重试/usage 语义。
- [ ] `tests/test_evals.py` 覆盖「直接查询」「先 describe 再查询」「工具报错后恢复」三条轨迹。
- [ ] 默认启动不打印完整 LLM 请求；需要时用 `FIREYEAUD_LLM_DEBUG_LOG=true` 打开。
- [ ] README 的安全描述与 P0/P2 的实际强制点逐条对应。

## 后续

P0–P3 四份计划完成后，仍可单独立项：

- 字段级授权与 `SELECT *` 展开（AST 反射列 + 授权列比对）。
- `graph.py` 工具循环与 `doc_chat` 的进一步合并（事件映射差异较大，建议在评测体系稳定后再动）。
- 证据链读取侧索引（sqlite 视图或按会话分片），当前只优化了写入路径。
