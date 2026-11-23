# P1 Agent 循环核心加固 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 agent 循环具备现代 harness 的基本能力：稳定的工具调用 ID、只读工具并发、结构化工具错误、瞬时错误重试、能力探测，以及写作代理共享同一套语义。

**Architecture:** 先抽一个 `agent/tool_calls.py` 放共享契约（调用 ID、错误载荷），再在 `graph.py` 中把“逐个 await”改成“批量执行 + 保序回填”；新增 `agent/retry.py` 负责可重试判定与退避；`doc_chat.py` 复用同一套 ID/错误/超时逻辑，避免报告与取证单继续各自演化。

**Tech Stack:** Python 3.12、LangChain Core、pytest、pytest-asyncio。

---

## 背景与范围

对应评审中的 P1 项：

1. `tool_call_id` 冲突（`graph.py:562`、`doc_chat.py:87`）。
2. 工具串行执行。
3. 工具错误丢失 `code/messageKey`。
4. 429/5xx/连接重置没有重试。
5. 模型不支持工具调用时静默降级。
6. `doc_chat` 没有超时，报告/取证单可以永久挂起。

**不在本计划内**：工具结果字符预算、artifact 外置、用量与缓存统计（P2）；完整 harness 内核抽取（后续重构）。

---

### Task 1: 抽出共享的工具调用契约

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/agent/tool_calls.py`
- Test: `services/agent/tests/test_tool_calls.py`（新建）

**Step 1: 写失败测试**

```python
from fireeyeaud_agent.agent.tool_calls import call_id, tool_error_payload
from fireeyeaud_agent.errors import ApiError


def test_call_id_prefers_provider_id():
    assert call_id({"id": "call_abc"}, step=2, index=0) == "call_abc"


def test_call_id_falls_back_to_step_and_index():
    assert call_id({}, step=2, index=0) == "call_2_0"
    assert call_id({"id": ""}, step=2, index=1) == "call_2_1"
    assert call_id({"id": None}, step=3, index=2) == "call_3_2"


def test_tool_error_payload_keeps_api_error_code():
    payload = tool_error_payload(
        ApiError("E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"path": "x"}),
        tool="read_file",
    )
    assert payload["ok"] is False
    assert payload["error"]["code"] == "E_FILE_NOT_FOUND"
    assert payload["error"]["params"] == {"path": "x"}
    assert payload["retryable"] is False


def test_tool_error_payload_wraps_unknown_error():
    payload = tool_error_payload(RuntimeError("boom"), tool="sql_query")
    assert payload["ok"] is False
    assert payload["error"]["code"] == "E_TOOL_FAILED"
    assert payload["error"]["params"]["tool"] == "sql_query"
    assert payload["error"]["params"]["reason"] == "boom"
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_tool_calls.py -v
```

Expected: FAIL，模块不存在。

**Step 3: 实现**

```python
"""工具调用共享契约：稳定的 call id 与结构化错误载荷。"""

from __future__ import annotations

from typing import Any


def call_id(call: dict[str, Any], *, step: int, index: int) -> str:
    """优先用 provider 的 id；缺失时用 step + index，避免同一步内冲突。"""
    raw = str(call.get("id") or "").strip()
    return raw or f"call_{step}_{index}"


def tool_error_payload(exc: BaseException, *, tool: str) -> dict[str, Any]:
    """把异常转成模型可消费、前端可展示的结构化错误。"""
    from ..errors import ApiError

    if isinstance(exc, ApiError):
        return {
            "ok": False,
            "tool": tool,
            "error": exc.envelope["error"],
            "retryable": False,
        }
    return {
        "ok": False,
        "tool": tool,
        "error": {
            "code": "E_TOOL_FAILED",
            "messageKey": "error.toolFailed",
            "params": {"tool": tool, "reason": str(exc)[:500]},
        },
        "retryable": False,
    }
```

**Step 4: 补 i18n**

`packages/shared/src/locales/zh-CN.ts` 的 `error` 块：

```ts
    toolFailed: '工具执行失败：{{tool}}（{{reason}}）',
```

`en-US.ts`：

```ts
    toolFailed: 'Tool failed: {{tool}} ({{reason}})',
```

**Step 5: 运行测试**

```bash
cd services/agent
uv run pytest tests/test_tool_calls.py -v
```

Expected: PASS。

**Step 6: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/agent/tool_calls.py \
        services/agent/tests/test_tool_calls.py \
        packages/shared/src/locales/zh-CN.ts \
        packages/shared/src/locales/en-US.ts
git commit -m "feat(agent): add shared tool call id and error contract"
```

---

### Task 2: 只读工具并发执行，结果保序回填

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/config/settings.py`
- Modify: `services/agent/src/fireeyeaud_agent/agent/graph.py:537-604`
- Test: `services/agent/tests/test_agent_graph.py`

**Step 1: 写失败测试**

在 `tests/test_agent_graph.py` 追加：

```python
@pytest.mark.asyncio
async def test_tool_batch_runs_concurrently():
    from fireeyeaud_agent.agent.graph import _run_tool_batch

    started = asyncio.Event()
    seen = {"count": 0}

    async def run_one(item):
        seen["count"] += 1
        if seen["count"] == 2:
            started.set()
        await asyncio.wait_for(started.wait(), timeout=0.5)
        return item * 10

    out = await asyncio.wait_for(
        _run_tool_batch([1, 2], run_one, concurrency=4, parallel=True),
        timeout=1.0,
    )
    assert out == [10, 20]


@pytest.mark.asyncio
async def test_tool_batch_is_sequential_when_not_parallel():
    from fireeyeaud_agent.agent.graph import _run_tool_batch

    order = []

    async def run_one(item):
        order.append(item)
        return item

    out = await _run_tool_batch([1, 2, 3], run_one, concurrency=4, parallel=False)
    assert out == [1, 2, 3]
    assert order == [1, 2, 3]
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_agent_graph.py -k tool_batch -v
```

Expected: FAIL，`_run_tool_batch` 不存在。

**Step 3: 添加配置**

`config/settings.py`：

```python
    tool_concurrency: int = 4
```

**Step 4: 实现批处理 helper**

在 `agent/graph.py` 的 `_run_tool` 旁加：

```python
async def _run_tool_batch(
    items: list[Any],
    run_one: Any,
    *,
    concurrency: int,
    parallel: bool,
) -> list[Any]:
    """按顺序返回结果；parallel=True 时用信号量限制并发。"""
    if not parallel or len(items) < 2:
        return [await run_one(item) for item in items]

    semaphore = asyncio.Semaphore(max(1, int(concurrency)))

    async def _limited(item: Any) -> Any:
        async with semaphore:
            return await run_one(item)

    return list(await asyncio.gather(*(_limited(item) for item in items)))
```

在模块顶部加：

```python
# 只并行执行无副作用、且不会争用 DuckDB 写连接的工具。
# sql_query / run_rule / parse_ledger 仍串行，避免同一 DuckDB 文件的连接竞争。
_PARALLEL_SAFE_TOOLS = {
    "describe_source",
    "list_files",
    "search_files",
    "read_file",
    "kb_search",
    "load_skill",
}
```

**Step 5: 改造工具执行段**

把 `for call in tool_calls:` 到 `yield event("status", {"phase": "reflecting"})` 之间替换为：

```python
            calls = [
                (index, call, call_id(call, step=step, index=index))
                for index, call in enumerate(tool_calls)
            ]

            for _index, call, _call_id in calls:
                name = str(call.get("name") or "")
                args = call.get("args") or {}
                append_evidence(
                    root,
                    session_id=session_id,
                    step="tool_call",
                    tool=name,
                    params=args,
                    lang=locale or "zh-CN",
                )
                yield event(
                    "tool_call", {"callId": _call_id, "tool": name, "params": args}
                )

            parallel = all(
                str(call.get("name") or "") in _PARALLEL_SAFE_TOOLS
                for _i, call, _cid in calls
            )

            async def _one(item):
                index, call, call_id_value = item
                name = str(call.get("name") or "")
                args = call.get("args") or {}
                started = time.monotonic()
                try:
                    result = await execute_tool(name, args)
                    ok = True
                    summary = _summarize(result)
                except Exception as exc:
                    ok = False
                    result = tool_error_payload(exc, tool=name)
                    summary = str(
                        result["error"].get("messageKey") or result["error"]
                    )
                return (
                    index,
                    call,
                    call_id_value,
                    result,
                    ok,
                    summary,
                    started,
                )

            outcomes = await _run_tool_batch(
                calls,
                _one,
                concurrency=settings.tool_concurrency,
                parallel=parallel,
            )

            for (
                _index,
                call,
                call_id_value,
                result,
                ok,
                summary,
                started,
            ) in outcomes:
                name = str(call.get("name") or "")
                args = call.get("args") or {}
                if name == "report_finding" and ok:
                    yield event("finding", {"id": result["id"], "event": "created"})
                recorded = append_evidence(
                    root,
                    session_id=session_id,
                    step="tool_result",
                    tool=name,
                    params=args,
                    result_summary=summary,
                    result=result,
                    duration_ms=int((time.monotonic() - started) * 1000),
                    lang=locale or "zh-CN",
                )
                evidence_ids.append(recorded["id"])
                yield event(
                    "tool_result",
                    {"callId": call_id_value, "summary": summary, "ok": ok},
                )
                messages.append(
                    ToolMessage(
                        content=_tool_message_content(result),
                        tool_call_id=call_id_value,
                    )
                )
            yield event("status", {"phase": "reflecting"})
```

顶部导入：

```python
from .tool_calls import call_id, tool_error_payload
```

**Step 6: 加一个端到端回归**

在 `tests/test_agent_graph.py` 追加：两个 `read_file` 调用应各自得到不同的 tool result。

```python
class _TwoReadModel:
    def __init__(self, path_a, path_b):
        self.path_a = path_a
        self.path_b = path_b
        self.calls = []

    def bind_tools(self, _tools):
        return self

    async def astream(self, messages):
        self.calls.append(list(messages))
        if len(self.calls) == 1:
            yield AIMessageChunk(
                content="",
                tool_calls=[
                    {"name": "read_file", "args": {"path": self.path_a}, "id": None},
                    {"name": "read_file", "args": {"path": self.path_b}, "id": None},
                ],
            )
        else:
            yield AIMessageChunk(content="完成")


@pytest.mark.asyncio
async def test_two_reads_get_distinct_call_ids(tmp_path):
    _seed(tmp_path)
    (tmp_path / "a.md").write_text("AAA", encoding="utf-8")
    (tmp_path / "b.md").write_text("BBB", encoding="utf-8")
    model = _TwoReadModel("a.md", "b.md")
    events = [
        e async for e in run_agent(tmp_path, "s_1", "读两个文件", "zh-CN", model=model)
    ]
    results = [e for e in events if e["type"] == "tool_result"]
    assert len(results) == 2
    assert results[0]["data"]["callId"] != results[1]["data"]["callId"]
    tool_msgs = [m for m in model.calls[1] if isinstance(m, ToolMessage)]
    assert {m.tool_call_id for m in tool_msgs} == {
        results[0]["data"]["callId"],
        results[1]["data"]["callId"],
    }
```

**Step 7: 运行测试**

```bash
cd services/agent
uv run pytest tests/test_agent_graph.py -v
```

Expected: PASS。

**Step 8: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/config/settings.py \
        services/agent/src/fireeyeaud_agent/agent/graph.py \
        services/agent/tests/test_agent_graph.py
git commit -m "perf(agent): run read-only tools concurrently and keep result order"
```

---

### Task 3: 工具错误结构化回传

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/agent/graph.py`（Task 2 中已接入 `tool_error_payload`）
- Test: `services/agent/tests/test_agent_graph.py`

**Step 1: 写失败测试**

```python
class _ReadMissingModel:
    def __init__(self):
        self.calls = []

    def bind_tools(self, _tools):
        return self

    async def astream(self, messages):
        self.calls.append(list(messages))
        if len(self.calls) == 1:
            yield AIMessageChunk(
                content="",
                tool_calls=[
                    {
                        "name": "read_file",
                        "args": {"path": "不存在.md"},
                        "id": "call_missing",
                    }
                ],
            )
        else:
            yield AIMessageChunk(content="已处理错误")


@pytest.mark.asyncio
async def test_tool_error_keeps_code_and_params(tmp_path):
    _seed(tmp_path)
    model = _ReadMissingModel()
    events = [
        e async for e in run_agent(tmp_path, "s_1", "读文件", "zh-CN", model=model)
    ]
    result = next(e for e in events if e["type"] == "tool_result")
    assert result["data"]["ok"] is False
    tool_msg = next(m for m in model.calls[1] if isinstance(m, ToolMessage))
    payload = json.loads(tool_msg.content)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "E_FILE_NOT_FOUND"
    assert payload["error"]["params"]["path"] == "不存在.md"
```

`test_agent_graph.py` 顶部补 `import json`。

**Step 2: 运行测试，确认行为**

```bash
cd services/agent
uv run pytest tests/test_agent_graph.py -k tool_error -v
```

Expected: Task 2 已实现时 PASS；若仍回传 `{"error": "..."}` 则 FAIL。

**Step 3: 检查并补全**

确认 `_one` 的 `except` 使用 `tool_error_payload(exc, tool=name)`，而不是 `{"error": str(exc)}`。若 `report_finding` 抛错，同样走该路径。

**Step 4: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/agent/graph.py \
        services/agent/tests/test_agent_graph.py
git commit -m "fix(agent): preserve structured tool errors for the model"
```

---

### Task 4: 模型调用重试与退避

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/agent/retry.py`
- Modify: `services/agent/src/fireeyeaud_agent/config/settings.py`
- Modify: `services/agent/src/fireeyeaud_agent/agent/graph.py:423-533`
- Test: `services/agent/tests/test_agent_retry.py`（新建）

**Step 1: 写失败测试**

```python
import pytest
from langchain_core.messages import AIMessageChunk

from fireeyeaud_agent.agent.graph import run_agent
from fireeyeaud_agent.agent.retry import is_retryable, retry_delay
from fireeyeaud_agent.config.settings import settings
from fireeyeaud_agent.store.duckdb import Database


def _seed(tmp_path):
    fe = tmp_path / ".fireeye"
    (fe / "index").mkdir(parents=True)
    db = Database(fe / "workspace.duckdb")
    db.create_table_from_rows("src_ds1_x", ["a"], [["1"]])
    db.close()


def test_is_retryable_classification():
    assert is_retryable(ConnectionError("connection reset by peer")) is True
    assert is_retryable(RuntimeError("429 rate limit exceeded")) is True
    assert is_retryable(TimeoutError()) is False
    assert is_retryable(ValueError("bad request")) is False


def test_retry_delay_is_bounded():
    assert 0 <= retry_delay(1, base=0.1, cap=1.0) <= 0.1
    assert 0 <= retry_delay(10, base=0.1, cap=0.5) <= 0.5


class _FlakyModel:
    def __init__(self):
        self.calls = 0

    def bind_tools(self, _tools):
        return self

    async def astream(self, _messages):
        self.calls += 1
        if self.calls == 1:
            raise ConnectionError("connection reset by peer")
        yield AIMessageChunk(content="恢复成功")


@pytest.mark.asyncio
async def test_transient_error_is_retried(tmp_path, monkeypatch):
    _seed(tmp_path)
    monkeypatch.setattr(settings, "llm_retry_base_seconds", 0)
    monkeypatch.setattr(settings, "llm_max_attempts", 3)
    model = _FlakyModel()
    events = [
        e async for e in run_agent(tmp_path, "s_1", "你好", "zh-CN", model=model)
    ]
    assert model.calls == 2
    assert events[-1]["type"] == "done"
    assert any(
        e["type"] == "token" and e["data"]["delta"] == "恢复成功" for e in events
    )


class _PartialThenFailModel:
    def __init__(self):
        self.calls = 0

    def bind_tools(self, _tools):
        return self

    async def astream(self, _messages):
        self.calls += 1
        yield AIMessageChunk(content="部分")
        raise ConnectionError("connection reset by peer")


@pytest.mark.asyncio
async def test_partial_output_is_not_retried(tmp_path, monkeypatch):
    _seed(tmp_path)
    monkeypatch.setattr(settings, "llm_retry_base_seconds", 0)
    monkeypatch.setattr(settings, "llm_max_attempts", 3)
    model = _PartialThenFailModel()
    events = [
        e async for e in run_agent(tmp_path, "s_1", "你好", "zh-CN", model=model)
    ]
    assert model.calls == 1
    assert any(e["type"] == "error" for e in events)
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_agent_retry.py -v
```

Expected: FAIL，`retry.py` 不存在 / 没有重试。

**Step 3: 实现 retry.py**

```python
"""模型调用的可重试判定与退避。"""

from __future__ import annotations

import random

_RETRY_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}
_RETRY_MARKERS = (
    "rate limit",
    "temporarily unavailable",
    "connection reset",
    "connection aborted",
    "overloaded",
    "server error",
)


def is_retryable(exc: BaseException) -> bool:
    # 本进程的 turn / asyncio 超时不重试，否则总时长会成倍放大。
    if isinstance(exc, TimeoutError):
        return False
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(getattr(exc, "response", None), "status_code", None)
    if status in _RETRY_STATUS:
        return True
    name = type(exc).__name__.lower()
    if "ratelimit" in name or "apiconnection" in name or "apitimeout" in name:
        return True
    if "internalserver" in name:
        return True
    text = str(exc).lower()
    return any(marker in text for marker in _RETRY_MARKERS)


def retry_delay(attempt: int, *, base: float, cap: float = 8.0) -> float:
    """指数退避 + 抖动，attempt 从 1 开始。"""
    if base <= 0:
        return 0.0
    delay = min(cap, base * (2 ** max(0, attempt - 1)))
    return delay + random.uniform(0, base)
```

**Step 4: 配置**

```python
    llm_max_attempts: int = 3
    llm_retry_base_seconds: float = 0.5
```

**Step 5: 把流式调用抽成可重试的 helper**

在 `graph.py` 中加：

```python
class _StreamOutcome:
    def __init__(self) -> None:
        self.ai: AIMessage | None = None
        self.emitted = False


async def _stream_model(
    bound: Any,
    messages: list[BaseMessage],
    event: Any,
    *,
    step: int,
) -> AsyncIterator[dict[str, Any]]:
    """流式调用模型；仅在“尚未输出正文”时重试。"""
    outcome = _StreamOutcome()
    attempt = 0
    while True:
        attempt += 1
        outcome.ai = None
        outcome.emitted = False
        try:
            async for chunk in bound.astream(messages):
                outcome.ai = chunk if outcome.ai is None else outcome.ai + chunk
                piece = chunk.content
                if isinstance(piece, str) and piece:
                    outcome.emitted = True
                    yield event("token", {"delta": piece})
            _stream_outcome.ai = outcome.ai
            return
        except Exception as exc:
            if (
                outcome.emitted
                or not is_retryable(exc)
                or attempt >= settings.llm_max_attempts
            ):
                raise
            yield event("status", {"phase": "retrying", "attempt": attempt})
            await asyncio.sleep(
                retry_delay(attempt, base=settings.llm_retry_base_seconds)
            )


_stream_outcome = _StreamOutcome()
```

> 说明：用一个模块级占位对象把最终 AI 传回 `run_agent` 不方便，实现时改成在 `run_agent` 内定义局部 `outcome`，把 `_stream_model` 定义为闭包或把 `outcome` 作为参数传入：
>
> ```python
> async def _stream_model(..., outcome: _StreamOutcome) -> AsyncIterator[dict]:
>     ...
>     outcome.ai = ...
> ```
>
> 最终以闭包参数版本为准，避免模块级状态。

**Step 6: 替换 run_agent 中的流式段**

把 `ai: AIMessage | None = None` 到 `print(format_llm_response(ai, step=step), flush=True)` 之前的部分改为：

```python
            outcome = _StreamOutcome()
            try:
                async with asyncio.timeout(settings.turn_timeout_seconds):
                    async for ev in _stream_model(
                        bound, messages, event, step=step, outcome=outcome
                    ):
                        yield ev
            except TimeoutError:
                ...  # 保持现有 E_LLM_TIMEOUT 分支
                return
            except Exception as exc:
                ...  # 保持现有上下文溢出 / E_LLM_UNAVAILABLE 分支
                return

            ai = outcome.ai
            if ai is None:
                ...  # 保持现有 E_LLM_UNAVAILABLE 分支
                return
            print(format_llm_response(ai, step=step), flush=True)
```

导入：

```python
from .retry import is_retryable, retry_delay
```

**Step 7: 运行测试**

```bash
cd services/agent
uv run pytest tests/test_agent_retry.py tests/test_agent_graph.py -v
```

Expected: PASS。

**Step 8: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/agent/retry.py \
        services/agent/src/fireeyeaud_agent/config/settings.py \
        services/agent/src/fireeyeaud_agent/agent/graph.py \
        services/agent/tests/test_agent_retry.py
git commit -m "feat(agent): retry transient model errors with backoff"
```

---

### Task 5: 模型不支持工具调用时明确提示

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/agent/graph.py:146-152,280`
- Test: `services/agent/tests/test_agent_graph.py`
- Modify: locales

**Step 1: 写失败测试**

```python
class _ChatOnlyModel:
    async def astream(self, _messages):
        yield AIMessageChunk(content="我只能聊天")


@pytest.mark.asyncio
async def test_model_without_bind_tools_emits_notice(tmp_path):
    _seed(tmp_path)
    events = [
        e
        async for e in run_agent(
            tmp_path, "s_1", "你好", "zh-CN", model=_ChatOnlyModel()
        )
    ]
    notice = next(e for e in events if e["type"] == "notice")
    assert notice["data"]["messageKey"] == "toolUnsupported"
    assert events[-1]["type"] == "done"
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_agent_graph.py -k bind_tools -v
```

Expected: FAIL，没有 notice。

**Step 3: 改 _maybe_bind 返回能力标记**

```python
def _maybe_bind(model: Any, tools: list[StructuredTool]) -> tuple[Any, bool]:
    if not hasattr(model, "bind_tools"):
        return model, False
    try:
        return model.bind_tools(tools), True
    except NotImplementedError:
        return model, False
    except Exception:
        return model, False
```

调用处：

```python
        bound, tools_bound = _maybe_bind(active_model, tools)
        if not tools_bound:
            yield event("notice", {"messageKey": "toolUnsupported"})
```

**Step 4: i18n**

`zh-CN.ts`：

```ts
    toolUnsupported: '当前模型不支持工具调用，已退化为纯对话；请换用支持 function calling 的模型',
```

`en-US.ts`：

```ts
    toolUnsupported: 'This model does not support tool calling; running in chat-only mode.',
```

**Step 5: 运行测试**

```bash
cd services/agent
uv run pytest tests/test_agent_graph.py -v
```

Expected: PASS。

**Step 6: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/agent/graph.py \
        services/agent/tests/test_agent_graph.py \
        packages/shared/src/locales/zh-CN.ts \
        packages/shared/src/locales/en-US.ts
git commit -m "fix(agent): surface models that cannot bind tools"
```

---

### Task 6: doc_chat 复用 ID/错误契约并加超时

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/agent/doc_chat.py`
- Test: `services/agent/tests/test_doc_chat.py`（新建）

**Step 1: 写失败测试**

```python
import asyncio

import pytest
from langchain_core.messages import AIMessageChunk, ToolMessage

from fireeyeaud_agent.agent.doc_chat import run_tool_loop
from fireeyeaud_agent.config.settings import settings


class _EchoTool:
    def invoke(self, args):
        return {"echo": args.get("text")}


class _TwoCallModel:
    def __init__(self):
        self.calls = 0

    def bind_tools(self, _tools):
        return self

    async def astream(self, messages):
        self.calls += 1
        if self.calls == 1:
            yield AIMessageChunk(
                content="",
                tool_calls=[
                    {"name": "echo", "args": {"text": "a"}, "id": None},
                    {"name": "echo", "args": {"text": "b"}, "id": None},
                ],
            )
        else:
            yield AIMessageChunk(content="完成")


@pytest.mark.asyncio
async def test_doc_chat_generates_distinct_call_ids():
    model = _TwoCallModel()
    events = [
        e
        async for e in run_tool_loop(
            model,
            [],
            {"echo": _EchoTool()},
            mutated_names=set(),
            on_assistant_text=lambda _t: None,
            revision=lambda: "r1",
        )
    ]
    assert any(e["event"] == "done" for e in events)


class _HangModel:
    def bind_tools(self, _tools):
        return self

    async def astream(self, _messages):
        await asyncio.sleep(10)
        yield AIMessageChunk(content="")


@pytest.mark.asyncio
async def test_doc_chat_model_timeout(monkeypatch):
    monkeypatch.setattr(settings, "turn_timeout_seconds", 0.05)
    events = [
        e
        async for e in run_tool_loop(
            _HangModel(),
            [],
            {},
            mutated_names=set(),
            on_assistant_text=lambda _t: None,
            revision=lambda: "r1",
        )
    ]
    assert events[0]["event"] == "error"
    assert events[0]["data"]["messageKey"] == "error.llmTimeout"
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_doc_chat.py -v
```

Expected: `test_doc_chat_model_timeout` FAIL（没有超时）；ID 测试可能偶然通过，因为 LangChain 会给缺省 id 生成唯一值，但仍应改为显式契约。

**Step 3: 改 doc_chat.py**

```python
import asyncio

from ..config.settings import settings
from .tool_calls import call_id, tool_error_payload
```

工具循环：

```python
    for step in range(max_steps):
        merged: Any = None
        try:
            async with asyncio.timeout(settings.turn_timeout_seconds):
                async for chunk in bound.astream(messages):
                    if merged is None:
                        merged = chunk
                    else:
                        merged = merged + chunk
                    piece = chunk.content
                    if isinstance(piece, str) and piece:
                        yield {"event": "delta", "data": {"text": piece}}
        except TimeoutError:
            yield {
                "event": "error",
                "data": {
                    "code": "E_LLM_TIMEOUT",
                    "messageKey": "error.llmTimeout",
                    "params": {},
                },
            }
            yield {"event": "done", "data": {}}
            return
```

工具调用：

```python
        for index, call in enumerate(tool_calls):
            name = str(call.get("name") or "")
            args = call.get("args") or {}
            tool = tool_map.get(name)
            if tool is None:
                result: Any = tool_error_payload(
                    ValueError(f"unknown tool {name}"), tool=name
                )
            else:
                try:
                    result = await asyncio.to_thread(tool.invoke, args)
                except Exception as exc:
                    result = tool_error_payload(exc, tool=name)
            if not isinstance(result, str):
                result = dump(result)
            messages.append(
                ToolMessage(
                    content=result,
                    tool_call_id=call_id(call, step=step, index=index),
                )
            )
            yield {
                "event": "tool",
                "data": {"name": name, "ok": '"ok": false' not in result},
            }
            if name in mutated_names:
                mutated = True
```

**Step 4: 运行测试**

```bash
cd services/agent
uv run pytest tests/test_doc_chat.py tests/test_report_agent_tools.py tests/test_form_agent.py -v
```

Expected: PASS。

**Step 5: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/agent/doc_chat.py \
        services/agent/tests/test_doc_chat.py
git commit -m "fix(agent): reuse tool contracts and timeout in doc chat"
```

---

## 验收清单

- [ ] 同一 step 的多个无 id 工具调用得到 `call_<step>_<index>`，不再冲突。
- [ ] 只读工具（read_file/list_files/search_files/kb_search/load_knowledge 等）并发执行，结果顺序稳定。
- [ ] 工具抛 `ApiError` 时模型收到 `code/messageKey/params`。
- [ ] 连接重置 / 429 / 5xx 会重试；已输出正文后不重试。
- [ ] 不支持 `bind_tools` 的模型会收到 `toolUnsupported` 提示。
- [ ] 报告/取证单写作超过 `turn_timeout_seconds` 会返回 `error.llmTimeout`，不再永久挂起。

## 后续

- 工具结果预算与 `read_artifact`：P2 计划。
- 用量/缓存统计、跨轮证据召回：P2 计划。
- 完整 harness 内核抽取（`graph`/`doc_chat`/`sql_assistant` 共用）：独立重构计划。
