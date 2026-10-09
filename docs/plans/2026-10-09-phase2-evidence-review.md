# Phase 2 — 证据与复核 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 建议按里程碑（G→H→I→J）分批执行，每个里程碑结束运行一次验证并以一次提交收尾。

**Goal:** 让每一步 Agent 操作与人工复核都留下**可校验的哈希链证据**，任一疑点可回溯完整推理步骤与工具调用；同时提供内置 + 自定义审计规则库（启停 / 覆盖 severity / 试跑 / 批量产出疑点）。

**Architecture:** 在既有 sidecar（FastAPI + LangGraph + DuckDB）上新增 `store/evidence.py`（append-only + SHA-256 哈希链）与 `store/rules.py`（事件流规则库）；`agent/graph.py` 在每次工具调用前后写证据，并把启用的 `prompt` 规则注入系统提示词；疑点复核事件追加到 `findings.jsonl`。渲染层新增复核 UI 与规则库设置页。

**Tech Stack:** Python 3.12 · FastAPI · LangGraph · DuckDB · hashlib（标准库）· React 18 · Zustand · Ant Design · i18next

---

## 决策与偏差（执行前须知，2026-10-09 用户确认）

1. **一份计划、三子系统按依赖排序**：里程碑 G（证据链基础）→ H（Agent 证据写入 + 疑点复核）→ I（规则库后端）→ J（规则库前端 + E2E）。
2. **内置规则最小集**：`tie_check`（代码检测器，复用 `check_tie` 逻辑）+ `related_party_undisclosed`（`prompt` 规则，Agent 判定）。
3. **复核人身份**：无用户体系；前端固定传占位 `reviewer`（默认「审计员」），后端原样存入事件。
4. **证据记录粒度**：只记录 `tool_call` 与 `tool_result` 两档（不记 thinking / llm_output）；结果超过 16KB 落 `.fireeye/artifacts/ev_<seq>.json`，事件只存 `artifactRef`。
5. **规则试跑语义**：`POST /rules/{id}/run` 为**干跑预览**（命中行上限 50 行 + 计数），**不写 findings**；另提供 `POST /rules/run` 批量执行启用规则并逐行 `create_finding`。
6. **prompt 规则注入**：启用的 `prompt` 规则文本拼接进 system prompt，Agent 按规则判定并 `report_finding`（`ruleKey` 带规则 id）。
7. **规则类型扩展**：`type ∈ {sql, prompt}`；内置 `tie_check` 额外带 `detector: "tie_check"` 字段标识其由代码实现（设计 §14.12 未定义 detector，属实现补充）。
8. **evidence 校验时机**：打开工作区时**同步**校验哈希链（数据量大时可能慢，Phase 2 先接受）。

---

## 里程碑总览

| 里程碑 | 内容 | 交付 |
|---|---|---|
| G | 证据日志 + 哈希链 + artifacts + 校验 | `evidence.jsonl` 可写可校验，`GET /evidence`、`verify-evidence` |
| H | Agent 集成证据写入 + 疑点人工复核 | 疑点可展开证据链并确认/驳回/标记 |
| I | 规则库（内置 + 自定义 + 试跑 + 批量运行） | `GET/POST/PATCH/DELETE /rules`、`POST /rules/{id}/run`、`POST /rules/run` |
| J | 规则库设置页 + 证据详情 + 端到端验收 | 完整 Phase 2 界面 |

---

## 里程碑 G — 证据链基础

### Task G1: 证据存储与哈希链（append + canonical）

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/evidence.py`
- Test: `services/agent/tests/test_evidence_store.py`

**Step 1: 写失败测试**

```python
from pathlib import Path

from fireeyeaud_agent.store.evidence import (
    append_evidence,
    compute_hash,
    load_evidence,
    verify_evidence_chain,
)


def test_append_evidence_builds_hash_chain(tmp_path: Path) -> None:
    root = tmp_path
    (root / ".fireeye").mkdir()
    first = append_evidence(
        root, session_id="s_1", step="tool_call", tool="sql_query",
        params={"sql": "SELECT 1"}, result_summary="1 行",
    )
    assert first["id"] == "ev_1"
    assert first["seq"] == 1
    assert first["prevHash"] == ""
    assert first["hash"].startswith("sha256:")

    second = append_evidence(
        root, session_id="s_1", step="tool_result", tool="sql_query",
        result_summary="命中 1 行", result={"rows": [["1"]]},
    )
    assert second["id"] == "ev_2"
    assert second["prevHash"] == first["hash"]

    assert compute_hash(first["prevHash"], first) == first["hash"]

    items = load_evidence(root)
    assert [e["id"] for e in items] == ["ev_1", "ev_2"]

    report = verify_evidence_chain(root)
    assert report["ok"] is True
    assert report["count"] == 2
```

**Step 2: 运行失败**

Run: `cd services/agent && uv run pytest tests/test_evidence_store.py -v`
Expected: FAIL（`ModuleNotFoundError: fireeyeaud_agent.store.evidence`）

**Step 3: 实现 `store/evidence.py`**

```python
"""证据日志（`evidence.jsonl`）与 SHA-256 哈希链（设计 §14.5）。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from ..util import now_iso
from .jsonl import append_event, next_seq, read_events

_ARTIFACT_THRESHOLD = 16 * 1024


def evidence_path(root: Path) -> Path:
    return Path(root) / ".fireeye" / "evidence.jsonl"


def _canonical(obj: dict[str, Any]) -> str:
    """去 `hash` 后 key 递归字典序、紧凑 JSON（与写入顺序无关）。"""
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def compute_hash(prev_hash: str, event: dict[str, Any]) -> str:
    body = {k: v for k, v in event.items() if k != "hash"}
    digest = hashlib.sha256(
        (prev_hash + _canonical(body)).encode("utf-8")
    ).hexdigest()
    return f"sha256:{digest}"


def _prev_hash(path: Path) -> str:
    events = read_events(path)
    return events[-1].get("hash", "") if events else ""


def append_evidence(
    root: Path,
    *,
    session_id: str,
    step: str,
    tool: str | None = None,
    params: dict[str, Any] | None = None,
    result_summary: str | None = None,
    result: Any = None,
    finding_refs: list[str] | None = None,
    duration_ms: int | None = None,
    tokens: int | None = None,
    lang: str = "zh-CN",
) -> dict[str, Any]:
    root = Path(root)
    path = evidence_path(root)
    seq = next_seq(path)
    ev_id = f"ev_{seq}"

    artifact_ref = None
    if result is not None:
        payload = _canonical(result if isinstance(result, dict) else {"value": result})
        if len(payload.encode("utf-8")) > _ARTIFACT_THRESHOLD:
            target = root / ".fireeye" / "artifacts" / f"{ev_id}.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(result, ensure_ascii=False), "utf-8")
            artifact_ref = f"artifacts/{ev_id}.json"

    event: dict[str, Any] = {
        "seq": seq,
        "id": ev_id,
        "sessionId": session_id,
        "ts": now_iso(),
        "step": step,
        "findingRefs": finding_refs or [],
        "tool": tool,
        "params": params or {},
        "resultSummary": result_summary,
        "artifactRef": artifact_ref,
        "durationMs": duration_ms,
        "tokens": tokens,
        "lang": lang,
        "prevHash": _prev_hash(path),
    }
    event["hash"] = compute_hash(event["prevHash"], event)
    return append_event(path, event)


def load_evidence(
    root: Path, finding_id: str | None = None, limit: int = 200
) -> list[dict[str, Any]]:
    items = read_events(evidence_path(Path(root)))
    if finding_id:
        from .findings import get_finding

        finding = get_finding(Path(root), finding_id)
        refs = set(finding.get("evidenceRefs", [])) if finding else set()
        items = [e for e in items if e.get("id") in refs]
    return items[:limit]


def verify_evidence_chain(root: Path) -> dict[str, Any]:
    events = read_events(evidence_path(Path(root)))
    prev = ""
    for event in events:
        if event.get("prevHash", "") != prev:
            return {"ok": False, "breakAt": event.get("seq"), "reason": "prev_mismatch"}
        if event.get("hash") != compute_hash(prev, event):
            return {"ok": False, "breakAt": event.get("seq"), "reason": "hash_mismatch"}
        prev = event.get("hash")
    return {"ok": True, "breakAt": None, "count": len(events), "head": prev}
```

**Step 4: 运行通过**

Run: `cd services/agent && uv run pytest tests/test_evidence_store.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/evidence.py services/agent/tests/test_evidence_store.py
git commit -m "feat(agent): 证据日志与 SHA-256 哈希链"
```

---

### Task G2: 篡改检测与断链定位

**Files:**
- Test: `services/agent/tests/test_evidence_store.py`（追加用例）

**Step 1: 写失败测试**

```python
def test_verify_detects_tampering(tmp_path: Path) -> None:
    root = tmp_path
    (root / ".fireeye").mkdir()
    append_evidence(root, session_id="s_1", step="tool_call", tool="a")
    append_evidence(root, session_id="s_1", step="tool_result", tool="a")
    append_evidence(root, session_id="s_1", step="tool_call", tool="b")

    path = root / ".fireeye" / "evidence.jsonl"
    lines = path.read_text("utf-8").splitlines()
    lines[1] = lines[1].replace("tool_result", "tool_call")
    path.write_text("\n".join(lines) + "\n", "utf-8")

    report = verify_evidence_chain(root)
    assert report["ok"] is False
    assert report["breakAt"] == 2
```

**Step 2: 运行** — `uv run pytest tests/test_evidence_store.py -v` → 若已实现应 PASS；否则检查 `compute_hash` 是否包含 `seq`。

**Step 3: Commit**

```bash
git add services/agent/tests/test_evidence_store.py
git commit -m "test(agent): 证据链篡改检测"
```

---

### Task G3: 证据查询与校验 API

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/api/evidence.py`
- Modify: `services/agent/src/fireeyeaud_agent/main.py`
- Modify: `services/agent/src/fireeyeaud_agent/api/workspaces.py`
- Test: `services/agent/tests/test_evidence_api.py`

**Step 1: 写失败测试**

```python
import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store.evidence import append_evidence


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


async def test_evidence_list_and_verify(tmp_path) -> None:
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        append_evidence(tmp_path, session_id="s_1", step="tool_call", tool="sql_query")
        append_evidence(tmp_path, session_id="s_1", step="tool_result", tool="sql_query")

        items = (await client.get("/api/v1/evidence")).json()["items"]
        assert [e["id"] for e in items] == ["ev_1", "ev_2"]

        ws = (await client.get("/api/v1/workspaces/current")).json()["workspace"]
        report = (
            await client.post(f"/api/v1/workspaces/{ws['id']}/verify-evidence")
        ).json()
        assert report["ok"] is True
        await client.post("/api/v1/workspaces/close")
```

**Step 2: 运行失败** — `uv run pytest tests/test_evidence_api.py -v` → FAIL（404）

**Step 3: 实现 `api/evidence.py`**

```python
"""证据查询路由（设计 §14.8）。"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends

from ..errors import ApiError
from ..store.evidence import load_evidence
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["evidence"], dependencies=[Depends(require_token)])


def _root() -> Path:
    if workspace_manager.root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    return workspace_manager.root


@router.get("/evidence")
def list_evidence(findingId: str | None = None, limit: int = 200) -> dict:
    if workspace_manager.root is None:
        return {"items": [], "nextCursor": None}
    items = load_evidence(workspace_manager.root, findingId, max(1, min(limit, 500)))
    return {"items": items, "nextCursor": None}
```

`main.py`：`from .api import ... evidence ...` 并在 `findings` 后 `app.include_router(evidence.router, prefix=API_PREFIX)`。

`api/workspaces.py` 追加：

```python
from ..store.evidence import verify_evidence_chain


@router.post("/workspaces/{workspace_id}/verify-evidence")
def verify_evidence(workspace_id: str) -> dict:
    if workspace_manager.root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    return verify_evidence_chain(workspace_manager.root)
```

（`api/workspaces.py` 需 `from ..errors import ApiError`。）

**Step 4: 运行通过** — `uv run pytest tests/test_evidence_api.py -v` → PASS

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/api/evidence.py services/agent/src/fireeyeaud_agent/api/workspaces.py services/agent/src/fireeyeaud_agent/main.py services/agent/tests/test_evidence_api.py
git commit -m "feat(agent): 证据查询与哈希链校验 REST"
```

---

### Task G4: 打开工作区时校验证据链

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/workspace.py`
- Test: `services/agent/tests/test_workspaces.py`（追加用例）

**Step 1: 写失败测试**

```python
async def test_open_reports_evidence_status(tmp_path) -> None:
    import httpx

    from fireeyeaud_agent.main import app
    from fireeyeaud_agent.store.evidence import append_evidence

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        append_evidence(tmp_path, session_id="s_1", step="tool_call", tool="x")
        await client.post("/api/v1/workspaces/close")
        opened = (await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})).json()
        assert opened["evidence"]["ok"] is True
        await client.post("/api/v1/workspaces/close")
```

**Step 2: 实现** — `WorkspaceManager.open` 末尾（`self.db = Database(...)` 之后）：

```python
from .evidence import verify_evidence_chain  # 模块顶部导入
...
project["evidence"] = verify_evidence_chain(root)
return project
```

**Step 3: 运行通过** — `cd services/agent && uv run pytest tests/test_workspaces.py -v` → PASS

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/workspace.py services/agent/tests/test_workspaces.py
git commit -m "feat(agent): 打开工作区时校验证据链完整性"
```

---

## 里程碑 H — Agent 证据写入 + 疑点复核

### Task H1: Agent 工具调用写入证据

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/agent/graph.py`
- Test: `services/agent/tests/test_agent_evidence.py`

**Step 1: 写失败测试**

```python
import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from fireeyeaud_agent.agent.graph import run_agent
from fireeyeaud_agent.store.duckdb import Database
from fireeyeaud_agent.store.evidence import load_evidence, verify_evidence_chain


def _seed(tmp_path):
    fe = tmp_path / ".fireeye"
    (fe / "index").mkdir(parents=True)
    db = Database(fe / "workspace.duckdb")
    db.create_table_from_rows("src_ds1_x", ["__row_id", "a"], [["1", "1"]])
    db.close()


@pytest.mark.asyncio
async def test_agent_writes_tool_evidence(tmp_path):
    _seed(tmp_path)
    tool_msg = AIMessage(content="", tool_calls=[
        {"name": "describe_source", "args": {}, "id": "call_1"}])
    final = AIMessage(content="完成")
    model = GenericFakeChatModel(messages=iter([tool_msg, final]))
    async for _ in run_agent(tmp_path, "s_1", "看看", "zh-CN", model=model):
        pass

    items = load_evidence(tmp_path)
    steps = [e["step"] for e in items]
    assert steps == ["tool_call", "tool_result"]
    assert items[0]["tool"] == "describe_source"
    assert verify_evidence_chain(tmp_path)["ok"] is True
```

**Step 2: 运行失败** — `uv run pytest tests/test_agent_evidence.py -v` → FAIL（`steps == []`）

**Step 3: 实现** — 在 `graph.py` 的 `execute_tool` 循环体内、`yield event("tool_call", ...)` 之前/之后写入证据，并累计 evidence id：

```python
import time
from ..store.evidence import append_evidence
...
    evidence_ids: list[str] = []
...
        for call in tool_calls:
            call_id = call.get("id") or f"call_{step}"
            name = call.get("name", "")
            args = call.get("args") or {}
            started = time.monotonic()
            append_evidence(
                root, session_id=session_id, step="tool_call",
                tool=name, params=args, lang=locale or "zh-CN",
            )
            yield event("tool_call", {"callId": call_id, "tool": name, "params": args})
            try:
                result = execute_tool(name, args, evidence_ids)
                ok = True
                summary = _summarize(result)
                if name == "report_finding":
                    yield event("finding", {"id": result["id"], "event": "created"})
            except Exception as exc:  # noqa: BLE001
                ok = False
                result = {"error": str(exc)}
                summary = str(exc)
            recorded = append_evidence(
                root, session_id=session_id, step="tool_result",
                tool=name, params=args, result_summary=summary,
                result=result, duration_ms=int((time.monotonic() - started) * 1000),
                lang=locale or "zh-CN",
            )
            evidence_ids.append(recorded["id"])
            yield event("tool_result", {"callId": call_id, "summary": summary, "ok": ok})
```

`execute_tool` 签名改为 `def execute_tool(name, args, evidence_ids)`，并把 `evidence_ids` 传给 `create_finding(..., evidenceRefs=list(evidence_ids))`（见 H2）。

**Step 4: 运行通过** — `uv run pytest tests/test_agent_evidence.py tests/test_agent_graph.py -v` → PASS

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/agent/graph.py services/agent/tests/test_agent_evidence.py
git commit -m "feat(agent): 工具调用写入证据日志"
```

---

### Task H2: 疑点反向关联证据

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/findings.py`
- Modify: `services/agent/src/fireeyeaud_agent/agent/graph.py`
- Test: `services/agent/tests/test_findings_store.py`（追加）

**Step 1: 写失败测试**

```python
def test_create_finding_links_evidence(tmp_path):
    from fireeyeaud_agent.store.evidence import append_evidence
    from fireeyeaud_agent.store.findings import create_finding, get_finding

    (tmp_path / ".fireeye").mkdir()
    ev = append_evidence(tmp_path, session_id="s_1", step="tool_result", tool="t")
    rec = create_finding(
        tmp_path, title=None, description=None, severity="high",
        dataRefs=[], sessionId="s_1", origin="rule", ruleKey="tie_check",
        evidenceRefs=[ev["id"]],
    )
    assert get_finding(tmp_path, rec["id"])["evidenceRefs"] == [ev["id"]]
```

**Step 2: 实现** — `create_finding` 签名调整：

```python
def create_finding(
    root, *, title=None, description=None, severity, dataRefs,
    sessionId, lang="zh-CN", confidence=None, subjects=None, amount=None,
    currency="CNY", ruleKey=None, params=None, origin="agent",
    evidenceRefs=None,
):
    ...
    "evidenceRefs": evidenceRefs or [],
```

（`title: str | None = None`、`description: str | None = None`；`ruleKey` 已存在。）

`graph.py` 的 `create_finding(...)` 调用追加 `origin="agent"`、`evidenceRefs=list(evidence_ids)`，并把 `report_finding` 的 `ruleKey` 透传（见 I3）。

**Step 3: 运行通过** — `uv run pytest tests/test_findings_store.py -v` → PASS

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/findings.py services/agent/src/fireeyeaud_agent/agent/graph.py services/agent/tests/test_findings_store.py
git commit -m "feat(agent): 疑点反向关联证据并支持规则型疑点"
```

---

### Task H3: 疑点复核事件写入

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/findings.py`
- Test: `services/agent/tests/test_findings_review.py`

**Step 1: 写失败测试**

```python
from fireeyeaud_agent.store.findings import (
    create_finding,
    get_finding,
    review_finding,
)


def _mk(tmp_path):
    (tmp_path / ".fireeye").mkdir(exist_ok=True)
    return create_finding(
        tmp_path, title="t", description="d", severity="high",
        dataRefs=[], sessionId="s_1",
    )["id"]


def test_review_status_note_severity(tmp_path):
    fid = _mk(tmp_path)
    review_finding(tmp_path, fid, action="confirm", reviewer="审计员", comment="已核实")
    review_finding(tmp_path, fid, action="note", reviewer="审计员", note="取得补充说明")
    review_finding(tmp_path, fid, action="severity", reviewer="审计员", severity="medium", reason="金额偏低")

    found = get_finding(tmp_path, fid)
    assert found["status"] == "confirmed"
    assert found["severity"] == "medium"
    assert found["notes"][-1]["note"]["text"] == "取得补充说明"
    assert found["reviews"][-1]["reviewer"] == "审计员"


def test_review_unknown_returns_none(tmp_path):
    (tmp_path / ".fireeye").mkdir(exist_ok=True)
    assert review_finding(tmp_path, "F-9999", action="confirm", reviewer="x") is None
```

**Step 2: 实现** — `store/findings.py` 追加 `review_finding`，并增强 `fold_findings`：

```python
def review_finding(
    root, finding_id, *, action, reviewer, comment=None,
    note=None, note_lang="zh-CN", severity=None, reason=None,
):
    root = Path(root)
    if get_finding(root, finding_id) is None:
        return None
    if action in ("confirm", "reject", "mark", "false_positive"):
        status = {
            "confirm": "confirmed", "reject": "rejected",
            "mark": "in_review", "false_positive": "false_positive",
        }[action]
        event = {
            "event": "status_changed", "id": finding_id, "status": status,
            "reviewer": reviewer, "comment": comment, "ts": now_iso(),
        }
    elif action == "note":
        event = {
            "event": "note_added", "id": finding_id,
            "note": {"lang": note_lang, "text": note}, "author": reviewer,
            "ts": now_iso(),
        }
    elif action == "severity":
        event = {
            "event": "severity_changed", "id": finding_id, "severity": severity,
            "reason": reason, "author": reviewer, "ts": now_iso(),
        }
    else:
        raise ApiError("E_INVALID_ACTION", 400, "error.internal", {"action": action})
    return append_event(findings_path(root), event)
```

`fold_findings` 中 `status_changed` 分支追加：

```python
                folded[fid]["status"] = event.get("status", folded[fid]["status"])
                folded[fid].setdefault("reviews", []).append({
                    "event": "status_changed", "status": event.get("status"),
                    "reviewer": event.get("reviewer"), "comment": event.get("comment"),
                    "ts": event.get("ts"),
                })
```

`severity_changed` 分支同样追加一条 `reviews` 记录（含 `reason`/`author`）。`created` 时初始化 `"reviews": []`。

（`store/findings.py` 顶部需 `from ..errors import ApiError`。）

**Step 3: 运行通过** — `uv run pytest tests/test_findings_review.py -v` → PASS

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/findings.py services/agent/tests/test_findings_review.py
git commit -m "feat(agent): 疑点复核事件（确认/驳回/标记/备注/改级别）"
```

---

### Task H4: 复核 REST API

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/api/findings.py`
- Test: `services/agent/tests/test_findings_review_api.py`

**Step 1: 写失败测试**

```python
import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store.findings import create_finding


async def test_review_api(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        fid = create_finding(
            tmp_path, title="t", description="d", severity="high",
            dataRefs=[], sessionId="s_1",
        )["id"]
        res = await client.post(
            f"/api/v1/findings/{fid}/review",
            json={"action": "confirm", "reviewer": "审计员", "comment": "ok"},
        )
        assert res.status_code == 200
        detail = (await client.get(f"/api/v1/findings/{fid}")).json()
        assert detail["status"] == "confirmed"
        assert detail["reviews"][0]["reviewer"] == "审计员"
        await client.post("/api/v1/workspaces/close")
```

**Step 2: 实现** — `api/findings.py` 追加：

```python
from pydantic import BaseModel

from ..store.findings import review_finding


class ReviewBody(BaseModel):
    action: str
    reviewer: str = "审计员"
    comment: str | None = None
    note: str | None = None
    noteLang: str = "zh-CN"
    severity: str | None = None
    reason: str | None = None


@router.post("/findings/{finding_id}/review")
def review(finding_id: str, body: ReviewBody) -> dict:
    result = review_finding(
        _root(), finding_id, action=body.action, reviewer=body.reviewer,
        comment=body.comment, note=body.note, note_lang=body.noteLang,
        severity=body.severity, reason=body.reason,
    )
    if result is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": finding_id})
    return result
```

**Step 3: 运行通过** — `uv run pytest tests/test_findings_review_api.py -v` → PASS

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/api/findings.py services/agent/tests/test_findings_review_api.py
git commit -m "feat(agent): 疑点复核 REST"
```

---

### Task H5: 前端复核 + 证据详情

**Files:**
- Modify: `packages/shared/src/types.ts`（`Finding` 增 `reviews`、`EvidenceItem`）
- Modify: `apps/renderer/src/lib/api.ts`（`reviewFindingApi`、`listEvidence`）
- Modify: `apps/renderer/src/store/findings.ts`（`review`）
- Create: `apps/renderer/src/components/FindingDetail.tsx`
- Modify: `apps/renderer/src/components/ResultsColumn.tsx`
- Modify: `packages/shared/src/locales/{zh-CN,en-US}.ts`（`evidence`/`findings` 补 key）
- Modify: `apps/renderer/src/styles/global.css`

**Step 1: 实现**

`types.ts` 追加：

```ts
export interface FindingReview {
  event: string;
  status?: FindingStatus;
  severity?: Severity;
  reviewer?: string;
  comment?: string | null;
  ts?: string;
}

export interface EvidenceItem {
  seq: number;
  id: string;
  sessionId: string;
  ts: string;
  step: 'tool_call' | 'tool_result';
  tool: string | null;
  params: Record<string, unknown>;
  resultSummary: string | null;
  artifactRef: string | null;
  durationMs?: number | null;
  lang?: string;
}
```

`Finding` 接口追加 `reviews?: FindingReview[];`。

`lib/api.ts` 追加：

```ts
export function reviewFindingApi(
  id: string,
  body: {
    action: string;
    reviewer?: string;
    comment?: string;
    note?: string;
    severity?: string;
    reason?: string;
  },
): Promise<unknown> {
  return request(`/findings/${id}/review`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function listEvidence(findingId?: string): Promise<{ items: EvidenceItem[] }> {
  const qs = findingId ? `?findingId=${encodeURIComponent(findingId)}` : '';
  return request(`/evidence${qs}`);
}
```

`store/findings.ts` 追加 `review: async (id, body) => { await reviewFindingApi(id, body); await get().load(); }`（`FindingsState` 接口加 `review`）。前端固定 `reviewer: '审计员'`。

`FindingDetail.tsx`：展开某疑点时 `listEvidence(finding.id)` 拉证据链，展示复核历史 + 证据条目（工具名 + 摘要 + 时间）；提供「确认 / 驳回 / 复核中 / 误报 / 备注 / 改级别」按钮，调用 `useFindingsStore.review`。

`ResultsColumn.tsx` 的 `FindingCard` 增加点击展开状态，展开处渲染 `<FindingDetail finding={finding} />`。

i18n：`evidence` 命名空间补 `chain`/`verifyOk`/`verifyBroken`/`step.tool_call`/`step.tool_result`/`noEvidence`；`findings` 补 `reviewer`/`confirm`/`reject`/`mark`/`falsePositive`/`addNote`/`changeSeverity`/`reviews`。`en-US` 同步。

CSS 补 `.finding--open`、`.finding__detail`、`.evidence-item`、`.review-row`。

**Step 2: 验证**

Run: `npm run renderer:typecheck && npm run renderer:build`
Expected: 无错误

**Step 3: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/locales/zh-CN.ts packages/shared/src/locales/en-US.ts apps/renderer/src/lib/api.ts apps/renderer/src/store/findings.ts apps/renderer/src/components/FindingDetail.tsx apps/renderer/src/components/ResultsColumn.tsx apps/renderer/src/styles/global.css
git commit -m "feat(renderer): 疑点复核与证据链详情"
```

---

## 里程碑 I — 规则库后端

### Task I1: 规则存储（内置 + 自定义回放折叠）

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/rules.py`
- Test: `services/agent/tests/test_rules_store.py`

**Step 1: 写失败测试**

```python
from fireeyeaud_agent.store.rules import (
    create_rule,
    fold_rules,
    list_rules,
    set_enabled,
    update_rule,
)


def test_builtin_and_custom_rules(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    rules = list_rules(tmp_path)
    ids = {r["id"] for r in rules}
    assert {"tie_check", "related_party_undisclosed"} <= ids
    builtin = next(r for r in rules if r["id"] == "tie_check")
    assert builtin["builtin"] is True and builtin["enabled"] is True

    created = create_rule(tmp_path, {
        "name": "大额关联方", "type": "sql", "severity": "high",
        "definition": "SELECT 1", "enabled": True,
    })
    assert created["id"] == "R-0001"
    assert created["scope"] == "custom"

    set_enabled(tmp_path, "R-0001", False)
    after = {r["id"]: r for r in list_rules(tmp_path)}
    assert after["R-0001"]["enabled"] is False

    update_rule(tmp_path, "R-0001", {"severity": "medium"})
    after = {r["id"]: r for r in list_rules(tmp_path)}
    assert after["R-0001"]["severity"] == "medium"


def test_builtin_override(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    set_enabled(tmp_path, "tie_check", False)
    rules = {r["id"]: r for r in list_rules(tmp_path)}
    assert rules["tie_check"]["enabled"] is False
```

**Step 2: 实现 `store/rules.py`**

```python
"""审计规则库：内置（只读）+ 项目自定义（`rules.jsonl` 事件流，设计 §14.12）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..util import now_iso
from .jsonl import append_event, read_events
from .project import next_counter

BUILTIN_RULES: list[dict[str, Any]] = [
    {
        "id": "tie_check",
        "scope": "builtin",
        "type": "sql",
        "detector": "tie_check",
        "nameKey": "builtin.tie_check",
        "descriptionKey": "builtin.tie_checkDesc",
        "severity": "high",
        "enabled": True,
        "builtin": True,
    },
    {
        "id": "related_party_undisclosed",
        "scope": "builtin",
        "type": "prompt",
        "nameKey": "builtin.relatedParty",
        "descriptionKey": "builtin.relatedPartyDesc",
        "definition": "检查关联方交易是否充分披露、是否有对价说明；发现疑似未披露时报告疑点。",
        "severity": "high",
        "enabled": True,
        "builtin": True,
    },
]


def rules_path(root: Path) -> Path:
    return Path(root) / ".fireeye" / "rules.jsonl"


def fold_rules(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    builtin = {r["id"]: dict(r) for r in BUILTIN_RULES}
    custom: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    for event in events:
        rid = event.get("id")
        kind = event.get("event")
        if not rid:
            continue
        if rid in builtin:
            if kind == "enabled_changed":
                builtin[rid]["enabled"] = bool(event.get("enabled"))
            elif kind == "severity_changed":
                builtin[rid]["severity"] = event.get("severity", builtin[rid]["severity"])
            continue
        if kind == "created":
            custom[rid] = {
                "id": rid, "scope": "custom",
                "type": event.get("type", "sql"),
                "name": event.get("name"),
                "definition": event.get("definition", ""),
                "severity": event.get("severity", "medium"),
                "params": event.get("params", {}),
                "enabled": bool(event.get("enabled", True)),
                "builtin": False,
                "ts": event.get("ts"),
            }
            order.append(rid)
        elif rid in custom:
            if kind == "updated":
                for key in ("name", "definition", "severity", "params", "type"):
                    if key in event:
                        custom[rid][key] = event[key]
            elif kind == "enabled_changed":
                custom[rid]["enabled"] = bool(event.get("enabled"))
            elif kind == "deleted":
                custom[rid]["_deleted"] = True

    result = list(builtin.values())
    result += [custom[rid] for rid in order if not custom[rid].get("_deleted")]
    return result


def list_rules(root: Path) -> list[dict[str, Any]]:
    return fold_rules(read_events(rules_path(root)))


def get_rule(root: Path, rule_id: str) -> dict[str, Any] | None:
    for rule in list_rules(root):
        if rule.get("id") == rule_id:
            return rule
    return None


def create_rule(root: Path, data: dict[str, Any]) -> dict[str, Any]:
    root = Path(root)
    fe = root / ".fireeye"
    seq_id = next_counter(fe, "rule", root)
    rule_id = f"R-{seq_id:04d}"
    event = {
        "event": "created", "id": rule_id, "scope": "custom",
        "type": data.get("type", "sql"),
        "name": data.get("name"), "definition": data.get("definition", ""),
        "severity": data.get("severity", "medium"), "params": data.get("params", {}),
        "enabled": bool(data.get("enabled", True)), "ts": now_iso(),
    }
    append_event(rules_path(root), event)
    return get_rule(root, rule_id)


def update_rule(root: Path, rule_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    if get_rule(root, rule_id) is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": rule_id})
    event = {"event": "updated", "id": rule_id, "ts": now_iso()}
    for key in ("name", "definition", "severity", "params", "type"):
        if key in patch and patch[key] is not None:
            event[key] = patch[key]
    append_event(rules_path(root), event)
    return get_rule(root, rule_id)


def set_enabled(root: Path, rule_id: str, enabled: bool) -> dict[str, Any]:
    if get_rule(root, rule_id) is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": rule_id})
    append_event(rules_path(root), {
        "event": "enabled_changed", "id": rule_id,
        "enabled": bool(enabled), "ts": now_iso(),
    })
    return get_rule(root, rule_id)


def delete_rule(root: Path, rule_id: str) -> None:
    rule = get_rule(root, rule_id)
    if rule is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": rule_id})
    if rule.get("builtin"):
        raise ApiError("E_RULE_INVALID", 400, "error.ruleInvalid", {"reason": "builtin"})
    append_event(rules_path(root), {"event": "deleted", "id": rule_id, "ts": now_iso()})
```

**Step 3: 运行通过** — `uv run pytest tests/test_rules_store.py -v` → PASS

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/rules.py services/agent/tests/test_rules_store.py
git commit -m "feat(agent): 审计规则存储（内置 + 自定义事件流）"
```

---

### Task I2: 规则试跑与批量运行

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/rule_engine.py`
- Test: `services/agent/tests/test_rule_engine.py`

**Step 1: 写失败测试**

```python
from fireeyeaud_agent.store.duckdb import Database
from fireeyeaud_agent.store.rule_engine import run_all_rules, run_rule
from fireeyeaud_agent.store.rules import create_rule


def _seed(tmp_path):
    fe = tmp_path / ".fireeye"
    (fe / "index").mkdir(parents=True)
    db = Database(fe / "workspace.duckdb")
    db.create_table_from_rows(
        "src_ds1_余额表",
        ["__row_id", "科目", "借方", "贷方"],
        [["1", "1001", "100", "0"], ["2", "1002", "0", "90"]],
    )
    db.close()


def test_run_sql_rule_dry_run(tmp_path):
    _seed(tmp_path)
    rule = create_rule(tmp_path, {
        "name": "余额非零", "type": "sql", "severity": "medium",
        "definition": "SELECT * FROM src_ds1_余额表",
    })
    preview = run_rule(tmp_path, rule["id"])
    assert preview["rowCount"] == 2
    assert len(preview["rows"]) == 2


def test_run_all_creates_findings(tmp_path):
    _seed(tmp_path)
    create_rule(tmp_path, {
        "name": "余额非零", "type": "sql", "severity": "medium",
        "definition": "SELECT * FROM src_ds1_余额表",
    })
    result = run_all_rules(tmp_path)
    assert result["count"] >= 2
    from fireeyeaud_agent.store.findings import load_findings
    assert any(f["origin"] == "rule" for f in load_findings(tmp_path))
```

**Step 2: 实现 `store/rule_engine.py`**

```python
"""规则引擎：试跑预览与批量产出疑点（设计 §14.12）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..errors import ApiError
from ..tools.check_tie import check_tie
from ..tools.sql_query import sql_query
from .findings import create_finding
from .index import load_schema
from .rules import get_rule, list_rules

_PREVIEW_LIMIT = 50
_CANDIDATE_COLUMNS = {"科目", "借方", "贷方"}


def _find_balance_table(root: Path) -> str | None:
    schema = load_schema(Path(root) / ".fireeye" / "index" / "schema.json")
    for entry in schema:
        cols = {c.get("name") for c in entry.get("columns", [])}
        if _CANDIDATE_COLUMNS <= cols:
            return entry.get("table")
    return None


def _run_detector(root: Path, detector: str) -> dict[str, Any]:
    if detector == "tie_check":
        table = _find_balance_table(root)
        if table is None:
            return {"ruleId": detector, "kind": "detector", "balanced": True, "diffs": []}
        result = check_tie(root, {"table": table})
        return {"ruleId": detector, "kind": "detector", "table": table, **result}
    raise ApiError("E_RULE_INVALID", 400, "error.ruleInvalid", {"detector": detector})


def run_rule(root: Path, rule_id: str) -> dict[str, Any]:
    rule = get_rule(root, rule_id)
    if rule is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": rule_id})
    if rule.get("detector"):
        return _run_detector(root, rule["detector"])
    if rule.get("type") != "sql":
        raise ApiError("E_RULE_NOT_RUNNABLE", 400, "error.ruleNotRunnable", {"id": rule_id})
    result = sql_query(root, {"sql": rule.get("definition", ""), "limit": _PREVIEW_LIMIT})
    return {"ruleId": rule_id, "kind": "sql", **result}


def run_all_rules(root: Path) -> dict[str, Any]:
    created: list[str] = []
    for rule in list_rules(root):
        if not rule.get("enabled"):
            continue
        rule_id = rule["id"]
        if rule.get("detector") == "tie_check":
            table = _find_balance_table(root)
            if table is None:
                continue
            result = check_tie(root, {"table": table})
            for diff in result["diffs"]:
                rec = create_finding(
                    root, title=None, description=None, severity=rule["severity"],
                    dataRefs=[{"sourceId": "", "table": table,
                               "rowRef": diff["subject"]}],
                    sessionId="", origin="rule", ruleKey=rule_id,
                    params={**diff, "table": table},
                )
                created.append(rec["id"])
        elif rule.get("type") == "sql" and not rule.get("builtin"):
            result = sql_query(root, {"sql": rule.get("definition", ""), "limit": 50})
            for row in result.get("rows", []):
                rec = create_finding(
                    root, title=None, description=None, severity=rule["severity"],
                    dataRefs=[], sessionId="", origin="rule", ruleKey=rule_id,
                    params={"row": row},
                )
                created.append(rec["id"])
    return {"created": created, "count": len(created)}
```

（`create_finding` 需已按 H2 放开 `title/description` 默认 None。）

**Step 3: 运行通过** — `uv run pytest tests/test_rule_engine.py -v` → PASS

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/rule_engine.py services/agent/tests/test_rule_engine.py
git commit -m "feat(agent): 规则引擎（试跑预览 + 批量产出疑点）"
```

---

### Task I3: 规则 REST API

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/api/rules.py`
- Modify: `services/agent/src/fireeyeaud_agent/main.py`
- Test: `services/agent/tests/test_rules_api.py`

**Step 1: 写失败测试**

```python
import httpx

from fireeyeaud_agent.main import app


async def test_rules_api_crud_and_run(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        items = (await client.get("/api/v1/rules")).json()["items"]
        assert any(r["id"] == "tie_check" for r in items)

        created = (await client.post("/api/v1/rules", json={
            "name": "非零", "type": "sql", "severity": "high",
            "definition": "SELECT 1",
        })).json()
        assert created["id"] == "R-0001"

        await client.patch(f"/api/v1/rules/{created['id']}", json={"enabled": False})
        after = {r["id"]: r for r in (await client.get("/api/v1/rules")).json()["items"]}
        assert after["R-0001"]["enabled"] is False

        # prompt 规则不可试跑
        not_runnable = await client.post("/api/v1/rules/related_party_undisclosed/run")
        assert not_runnable.status_code == 400

        await client.delete(f"/api/v1/rules/{created['id']}")
        remaining = {r["id"] for r in (await client.get("/api/v1/rules")).json()["items"]}
        assert "R-0001" not in remaining
        await client.post("/api/v1/workspaces/close")
```

**Step 2: 实现 `api/rules.py`**

```python
"""规则库路由（设计 §14.8 / §14.12）。"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..errors import ApiError
from ..store import rules as rules_store
from ..store.rule_engine import run_all_rules, run_rule
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["rules"], dependencies=[Depends(require_token)])


class RuleBody(BaseModel):
    name: str | None = None
    type: str = "sql"
    definition: str = ""
    severity: str = "medium"
    params: dict = {}
    enabled: bool = True


class RulePatch(BaseModel):
    name: str | None = None
    type: str | None = None
    definition: str | None = None
    severity: str | None = None
    params: dict | None = None
    enabled: bool | None = None


def _root() -> Path:
    if workspace_manager.root is None:
        raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
    return workspace_manager.root


@router.get("/rules")
def list_rules() -> dict:
    if workspace_manager.root is None:
        return {"items": [], "nextCursor": None}
    return {"items": rules_store.list_rules(workspace_manager.root), "nextCursor": None}


@router.post("/rules")
def create_rule(body: RuleBody) -> dict:
    return rules_store.create_rule(_root(), body.model_dump())


@router.post("/rules/run")
def run_rules() -> dict:
    return run_all_rules(_root())


@router.patch("/rules/{rule_id}")
def update_rule(rule_id: str, body: RulePatch) -> dict:
    patch = body.model_dump(exclude_unset=True)
    if "enabled" in patch:
        rules_store.set_enabled(_root(), rule_id, bool(patch["enabled"]))
        patch.pop("enabled")
    if patch:
        return rules_store.update_rule(_root(), rule_id, patch)
    return rules_store.get_rule(_root(), rule_id)


@router.post("/rules/{rule_id}/run")
def run_single(rule_id: str) -> dict:
    return run_rule(_root(), rule_id)


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: str) -> dict:
    rules_store.delete_rule(_root(), rule_id)
    return {"ok": True}
```

> 注意路由顺序：`POST /rules/run` 必须在 `POST /rules/{rule_id}/run` 之前注册，避免 `run` 被当作 `{rule_id}`。`main.py` 追加 `from .api import rules` 与 `app.include_router(rules.router, prefix=API_PREFIX)`。

**Step 3: 运行通过** — `uv run pytest tests/test_rules_api.py -v` → PASS

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/api/rules.py services/agent/src/fireeyeaud_agent/main.py services/agent/tests/test_rules_api.py
git commit -m "feat(agent): 规则库 REST（CRUD / 试跑 / 批量运行）"
```

---

### Task I4: prompt 规则注入 Agent

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/agent/prompts.py`
- Modify: `services/agent/src/fireeyeaud_agent/agent/graph.py`
- Test: `services/agent/tests/test_prompt_rules.py`

**Step 1: 写失败测试**

```python
from fireeyeaud_agent.agent.prompts import system_prompt


def test_system_prompt_injects_prompt_rules():
    base = system_prompt("zh-CN")
    injected = system_prompt("zh-CN", prompt_rules=[
        {"id": "related_party_undisclosed", "definition": "检查关联方披露。"},
    ])
    assert "related_party_undisclosed" in injected
    assert "检查关联方披露。" in injected
    assert injected != base
```

**Step 2: 实现** — `prompts.py`：

```python
def system_prompt(locale: str | None, prompt_rules: list[dict] | None = None) -> str:
    directive = _EN_DIRECTIVE if locale == "en-US" else _ZH_DIRECTIVE
    text = _BASE
    if prompt_rules:
        lines = ["", "须遵循的审计规则（命中时必须调用 report_finding，ruleKey 用规则 id）："]
        for rule in prompt_rules:
            lines.append(f"- [{rule.get('id')}] {rule.get('definition', '')}")
        text += "\n".join(lines) + "\n"
    return text + directive
```

`graph.py` 的 `run_agent`：加载启用的 prompt 规则并传入；`report_finding` 增加 `ruleKey` 参数并透传给 `create_finding`：

```python
from ..store.rules import list_rules
...
    prompt_rules = [
        r for r in list_rules(root)
        if r.get("enabled") and r.get("type") == "prompt" and r.get("definition")
    ]
    messages = [SystemMessage(content=system_prompt(locale, prompt_rules))]
```

`ReportFindingArgs` 增加 `ruleKey: str | None = None`，`execute_tool` 的 `report_finding` 分支 `create_finding(..., ruleKey=args.get("ruleKey"))`。

**Step 3: 运行通过** — `cd services/agent && uv run pytest tests/test_prompt_rules.py tests/test_agent_graph.py -v` → PASS

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/agent/prompts.py services/agent/src/fireeyeaud_agent/agent/graph.py services/agent/tests/test_prompt_rules.py
git commit -m "feat(agent): 注入 prompt 规则并支持规则型疑点"
```

---

## 里程碑 J — 规则库前端 + 端到端验收

### Task J1: 规则库设置页

**Files:**
- Create: `apps/renderer/src/store/rules.ts`
- Create: `apps/renderer/src/components/panels/RulesPanel.tsx`
- Modify: `apps/renderer/src/components/panels/SettingsPanel.tsx`（`rules` nav 渲染 `RulesPanel`）
- Modify: `apps/renderer/src/lib/api.ts`（`listRules/createRule/updateRuleApi/deleteRuleApi/runRuleApi/runAllRulesApi`）
- Modify: `packages/shared/src/types.ts`（`AuditRule`）
- Modify: `packages/shared/src/locales/{zh-CN,en-US}.ts`（`rules.*` 扩充）
- Modify: `apps/renderer/src/styles/global.css`

**Step 1: 实现**

`types.ts` 追加：

```ts
export interface AuditRule {
  id: string;
  scope: 'builtin' | 'custom';
  type: 'sql' | 'prompt';
  detector?: string;
  name?: { lang: string; text: string } | null;
  nameKey?: string;
  descriptionKey?: string;
  definition?: string;
  severity: Severity;
  params?: Record<string, unknown>;
  enabled: boolean;
  builtin: boolean;
}
```

`lib/api.ts` 追加 `listRules()`、`createRule(input)`、`updateRuleApi(id, patch)`、`deleteRuleApi(id)`、`runRuleApi(id)`、`runAllRulesApi()`。

`store/rules.ts`：`items`/`loading`/`errorKey`/`load`/`add`/`toggle`/`remove`/`preview(id)`/`runAll()`；`preview` 存 `previewById: Record<string, unknown>`。

`RulesPanel.tsx`：两段列表——内置规则（名称走 `rules.builtin.*` i18n，启停开关 + severity 下拉 + 「试跑」按钮，试跑结果展示命中行/差异）+ 自定义规则（增删改启停、类型 sql/prompt）+「批量运行」按钮（调 `runAll`，完成后刷新 findings）。

`SettingsPanel.tsx`：`nav === 'rules'` 时渲染 `<RulesPanel />`（替换 `comingSoon`）。

i18n `rules` 补：`builtin.tie_check`/`builtin.tie_checkDesc`/`builtin.relatedParty`/`builtin.relatedPartyDesc`/`addRule`/`type`/`typeSql`/`typePrompt`/`definition`/`severity`/`enabled`/`preview`/`run`/`runAll`/`runResult`/`noHits`/`custom`/`promptNotRunnable`；`error.ruleInvalid`/`error.ruleNotRunnable`。

**Step 2: 验证**

Run: `npm run renderer:typecheck && npm run renderer:build && npm run desktop:test`
Expected: 全部通过

**Step 3: Commit**

```bash
git add apps/renderer/src/store/rules.ts apps/renderer/src/components/panels/RulesPanel.tsx apps/renderer/src/components/panels/SettingsPanel.tsx apps/renderer/src/lib/api.ts packages/shared/src/types.ts packages/shared/src/locales/zh-CN.ts packages/shared/src/locales/en-US.ts apps/renderer/src/styles/global.css
git commit -m "feat(renderer): 规则库设置页（启停 / 覆盖级别 / 试跑 / 批量运行）"
```

---

### Task J2: 端到端验收与文档

**Step 1: 后端全量测试**

Run: `cd services/agent && uv run pytest`
Expected: 全绿

**Step 2: 前端检查**

Run: `npm run renderer:typecheck && npm run renderer:build && npm run desktop:test`
Expected: 全绿

**Step 3: 手动 E2E（需真实模型）**

1. `npm run dev` 启动；
2. 打开含科目余额表 xlsx 的工作区；
3. 导入数据 → 对话「统计各科目借贷合计并检查勾稽」；
4. 疑点卡片展开 → 查看证据链（tool_call/tool_result）与复核按钮 → 确认/驳回；
5. 设置页「规则库」→ 停用/覆盖 `tie_check` severity → 试跑查看差异预览 → 批量运行 → 疑点清单出现 `origin=rule` 条目；
6. 关闭并重开工作区 → 无断链告警；手动篡改 `evidence.jsonl` 一行 → 重开出现断链告警。

**Step 4: 更新 README / 计划文档偏差记录**

在 `README.md` 状态段追加 Phase 2 已完成项与已知偏差（证据仅记 tool_call/tool_result、reviewer 为占位、打开工作区同步校验、tie_check 由代码检测器实现）；在本计划末尾追加「Phase 2 实现记录」小节。

**Step 5: Commit**

```bash
git add -A
git commit -m "docs: Phase 2 验收记录与偏差说明"
```

---

## 风险与注意事项

- **哈希链 canonical 稳定性**：必须用 `sort_keys=True, separators=(",", ":")`，且 `seq` 参与哈希；否则 `verify` 与 `append` 不一致。
- **append_event 的 seq 推导**：evidence 事件在写入前已含 `seq`，`append_event` 内 `{"seq": seq, **event}` 以 event 的 seq 覆盖，值相同，安全。
- **规则路由顺序**：`POST /rules/run` 必须先于 `POST /rules/{id}/run` 注册。
- **内置规则不可删除**：`delete_rule` 对 `builtin` 抛 `E_RULE_INVALID`。
- **prompt 规则试跑**：返回 400 `E_RULE_NOT_RUNNABLE`（不执行 SQL）。
- **打开工作区同步校验**：证据量大时可能拖慢打开；Phase 2 接受，后续可改异步/缓存校验到头节点。
- **artifacts 阈值**：16KB；`artifactRef` 相对 `.fireeye/`。

---

## 已确认的偏差（2026-10-09 用户确认）

1. ✅ 一份计划、三子系统按依赖排序（G→H→I→J）。
2. ✅ 内置规则最小集：`tie_check`（代码检测器）+ `related_party_undisclosed`（prompt）。
3. ✅ reviewer 由前端固定传占位「审计员」。
4. ✅ 证据只记 `tool_call`/`tool_result` 两档，大结果落 artifacts。
5. ✅ `POST /rules/{id}/run` 为干跑预览；`POST /rules/run` 批量写 findings。
6. ✅ prompt 规则注入 system prompt。
7. ✅ 内置 `tie_check` 以 `detector` 字段标识代码实现（设计补充）。

---

## Phase 2 实现记录（2026-10-09 完成）

里程碑 G–J 均已完成并逐任务提交：

- **G 证据链基础**：`store/evidence.py`（canonical + SHA-256 哈希链 + 大结果落 artifacts）；篡改检测；`GET /evidence`、`POST /workspaces/{id}/verify-evidence`；打开工作区返回 `evidence` 校验状态。
- **H Agent 证据写入 + 疑点复核**：`agent/graph.py` 每次工具调用前后写 `tool_call`/`tool_result` 证据；疑点反向关联 `evidenceRefs`；`review_finding`（确认/驳回/标记/备注/改级别）+ `POST /findings/{id}/review`；前端疑点卡片可展开证据链与复核记录。
- **I 规则库后端**：`store/rules.py`（内置 + 自定义事件流折叠）、`store/rule_engine.py`（试跑预览 + 批量产出疑点）、`api/rules.py`（CRUD/试跑/批量运行）、prompt 规则注入系统提示词、`report_finding.ruleKey`。
- **J 前端**：规则库设置页（启停/覆盖 severity/试跑/批量运行）、i18n、类型与样式。

**验证：** 后端 `uv run pytest` 全绿（83 passed）；`renderer:typecheck` / `renderer:build` / `desktop:test` 均通过。真实模型端到端流程需按 J2 Step 3 人工验证。

**实现期间的说明：**

1. `tie_check` 内置规则以 `detector` 字段标识代码实现（设计 §14.12 未定义，属实现补充）；其试跑与批量运行扫描「科目/借方/贷方」列齐全的表。
2. 内置规则文案 key 由 `rules.builtin.<slug>` 调整为 `rules.builtinRules.<slug>`，避免与 `rules.builtin`（分组标题）冲突。
3. evidence 的 `seq` 参与哈希；`append_event` 以事件自带 `seq` 覆盖，值一致，保证 `verify` 与 `append` 一致。

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-10-09-phase2-evidence-review.md`. Two execution options:

**1. Subagent-Driven (this session)** — 每个 Task 派发新的 subagent，任务间我审查，迭代快（REQUIRED SUB-SKILL: superpowers:subagent-driven-development）。

**2. Parallel Session (separate)** — 新会话用 executing-plans 按里程碑批量执行并在检查点暂停（REQUIRED SUB-SKILL: superpowers:executing-plans）。

Which approach?
