# 疑点与证据重构 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把成果栏收敛为四个 tab，并完成「人工创建/删除疑点 + 疑点详情上下分块 + 证据补充/移除」的完整闭环。

**Architecture:** 后端继续使用 append-only JSONL：疑点删除、证据挂接/摘除都追加事件，折叠时生效；证据文件复制到项目根目录 `证据/`，哈希链不变。前端把成果栏拆成壳 + 四个视图，本计划实现疑点视图，取证单/报告/归档先放占位组件。

**Tech Stack:** FastAPI + pytest、React + TypeScript + Zustand、Ant Design、Electron IPC。

**Depends on:** 无。后续 P3 依赖本计划的疑点多选与证据 API。

---

## 0. 范围与非目标

本计划只做：

- `ResultsTab` 改为 `findings | evidence-form | report | archive`。
- 移除证据图谱、证据日志、底稿预览三个 tab 入口。
- 手动创建疑点、软删除疑点。
- 疑点详情改为「上：疑点内容；下：证据」。
- 证据支持三种补充方式：上传文件、文字说明、手工核查记录。
- 证据支持从疑点移除（detach，不删除证据日志）。
- 多选疑点（供 P3 生成取证单）。

不做：取证单/报告生成、模板中心、归档（分别见 P2/P3/P4）。

---

## 1. 关键文件

后端：

- `services/agent/src/fireeyeaud_agent/store/findings.py`
- `services/agent/src/fireeyeaud_agent/store/evidence.py`
- `services/agent/src/fireeyeaud_agent/store/evidence_files.py`（新建）
- `services/agent/src/fireeyeaud_agent/api/findings.py`
- `services/agent/src/fireeyeaud_agent/api/evidence.py`
- `services/agent/tests/test_findings_store.py`（新建或追加）
- `services/agent/tests/test_findings_manual_api.py`（新建）
- `services/agent/tests/test_evidence_manual.py`（新建）

共享类型与文案：

- `packages/shared/src/types.ts`
- `packages/shared/src/locales/zh-CN.ts`
- `packages/shared/src/locales/en-US.ts`

前端：

- `apps/renderer/src/store/ui.ts`
- `apps/renderer/src/store/findings.ts`
- `apps/renderer/src/lib/api.ts`
- `apps/renderer/src/components/ResultsColumn.tsx`
- `apps/renderer/src/components/FindingDetail.tsx`
- `apps/renderer/src/components/results/FindingsView.tsx`（新建）
- `apps/renderer/src/components/results/FindingCard.tsx`（新建）
- `apps/renderer/src/components/results/NewFindingDialog.tsx`（新建）
- `apps/renderer/src/components/results/AddEvidenceDialog.tsx`（新建）
- `apps/renderer/src/components/results/EvidenceFormsView.tsx`（新建，占位）
- `apps/renderer/src/components/results/ReportsView.tsx`（新建，占位）
- `apps/renderer/src/components/results/ArchiveView.tsx`（新建，占位）
- `apps/renderer/src/styles/global.css`

---

## Task 1: 扩展共享类型与文案

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/locales/zh-CN.ts`
- Modify: `packages/shared/src/locales/en-US.ts`

**Step 1: 改类型**

`Finding` 增加来源作者与删除标记（`deleted` 只用于内部折叠，前端可忽略）：

```ts
export interface Finding {
  // ...existing
  /** 人工创建者；Agent 创建时为空。 */
  author?: string | null;
  /** 软删除标记；列表接口不会返回已删除项。 */
  deleted?: boolean;
}
```

`EvidenceItem` 扩展：

```ts
export type EvidenceStep = 'tool_call' | 'tool_result' | 'manual';
export type EvidenceSource = 'agent' | 'manual';
export type EvidenceKind = 'file' | 'text' | 'record';

export interface EvidenceItem {
  seq: number;
  id: string;
  sessionId: string;
  ts: string;
  step: EvidenceStep;
  source?: EvidenceSource;
  kind?: EvidenceKind;
  title?: string | null;
  note?: string | null;
  filePath?: string | null;
  fileHash?: string | null;
  tool: string | null;
  params: Record<string, unknown>;
  resultSummary: string | null;
  artifactRef: string | null;
  durationMs?: number | null;
  tokens?: number | null;
  lang?: string;
  prevHash?: string;
  hash?: string;
}
```

`ActivityView` 暂不改（模板中心在 P2 改）。

**Step 2: 改文案**

`zh-CN.ts`：

```ts
results: {
  findings: '疑点',
  evidenceForm: '取证单',
  report: '项目报告',
  archive: '归档',
  empty: '暂无内容',
},
```

`en-US.ts` 对应：

```ts
results: {
  findings: 'Findings',
  evidenceForm: 'Evidence forms',
  report: 'Reports',
  archive: 'Archive',
  empty: 'Nothing here yet',
},
```

`enums.event` 增加：

```ts
deleted: '删除',
evidence_attached: '关联证据',
evidence_detached: '移除证据',
```

`evidence.step` 增加 `manual: '人工录入'`。`findings` 命名空间增加：

```ts
addFinding: '新建疑点',
deleteFinding: '删除疑点',
deleteConfirm: '删除后该疑点不再出现在列表中，但审计日志与已生成文档保留。确定删除？',
title: '疑点标题',
description: '疑点描述',
severity: '风险等级',
subjects: '涉及科目',
amount: '金额',
selected: '已选 {{count}} 项',
clearSelection: '清空选择',
manualBadge: '人工',
detailContent: '疑点内容',
detailEvidence: '证据',
addEvidence: '补充证据',
removeEvidence: '移除证据',
removeEvidenceConfirm: '仅从该疑点移除证据，证据日志与哈希链仍保留。确定？',
evidenceFile: '上传文件',
evidenceText: '文字说明',
evidenceRecord: '手工核查记录',
evidenceTitle: '证据标题',
evidenceNote: '说明',
chooseFile: '选择文件',
fileChosen: '已选择：{{name}}',
noFileChosen: '尚未选择文件',
```

**Step 3: 运行类型检查（预期失败点：旧 tab 文案引用）**

Run: `npm run renderer:typecheck`

Expected: 仅出现 `ResultsColumn.tsx` / `ui.ts` 的 tab 类型错误；先记录，Task 6 修复。

**Step 4: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/locales/zh-CN.ts packages/shared/src/locales/en-US.ts
git commit -m "feat(shared): add manual evidence and finding deletion types"
```

---

## Task 2: 疑点软删除与人工创建（后端）

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/findings.py`
- Test: `services/agent/tests/test_findings_store.py`

**Step 1: 写失败测试**

```python
from fireeyeaud_agent.store.findings import (
    create_finding,
    delete_finding,
    load_findings,
    get_finding,
)


def test_manual_finding_create_and_soft_delete(tmp_path):
    created = create_finding(
        tmp_path,
        title="手工疑点",
        description="说明",
        severity="high",
        dataRefs=[],
        sessionId="",
        origin="manual",
        author="张审计",
    )
    assert created["id"] == "F-0001"
    assert created["origin"] == "manual"
    assert created["author"] == "张审计"

    items = load_findings(tmp_path)
    assert [i["id"] for i in items] == ["F-0001"]

    deleted = delete_finding(tmp_path, "F-0001", author="张审计")
    assert deleted is not None
    assert deleted["event"] == "deleted"
    assert load_findings(tmp_path) == []
    assert get_finding(tmp_path, "F-0001") is None
    assert delete_finding(tmp_path, "F-9999", author="张审计") is None
```

**Step 2: 运行测试确认失败**

Run: `npm run agent:test -- tests/test_findings_store.py -q`

Expected: `ImportError: cannot import name 'delete_finding'`。

**Step 3: 最小实现**

`findings.py` 修改：

- `create_finding` 增加参数 `author: str | None = None`，事件写 `author`。
- 增加 `delete_finding`。
- `fold_findings` 在 `created` 时写入 `deleted: False`；遇到 `deleted` 时置 `True`、记录 `deletedAt`。
- `load_findings` 过滤 `deleted`。
- `get_finding` 继续走过滤后的 `load_findings`，自然拿不到已删除项。

```python
def delete_finding(
    root: Path, finding_id: str, *, author: str | None = None
) -> dict[str, Any] | None:
    root = Path(root)
    if get_finding(root, finding_id) is None:
        return None
    return append_event(
        findings_path(root),
        {
            "event": "deleted",
            "id": finding_id,
            "author": author,
            "ts": now_iso(),
        },
    )
```

`fold_findings` 片段：

```python
if kind == "created":
    folded[fid] = {**event, "notes": [], "reviews": [], "deleted": False}
    order.append(fid)
elif fid in folded:
    if kind == "deleted":
        folded[fid]["deleted"] = True
        folded[fid]["deletedAt"] = event.get("ts")
    # ...existing branches
```

`load_findings`：

```python
return [folded[fid] for fid in order if not folded[fid].get("deleted")]
```

> 注意：`review_finding` 内部调用 `get_finding`，删除后会自动拒绝追加复核事件。这是预期行为。

**Step 4: 运行测试**

Run: `npm run agent:test -- tests/test_findings_store.py -q`

Expected: PASS。

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/findings.py services/agent/tests/test_findings_store.py
git commit -m "feat(findings): support manual create and soft delete"
```

---

## Task 3: 证据挂接/摘除事件（后端）

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/findings.py`
- Test: `services/agent/tests/test_findings_store.py`

**Step 1: 写失败测试**

```python
from fireeyeaud_agent.store.findings import (
    attach_evidence,
    detach_evidence,
    create_finding,
    get_finding,
)


def test_attach_and_detach_evidence(tmp_path):
    create_finding(
        tmp_path,
        title="t",
        description="d",
        severity="high",
        dataRefs=[],
        sessionId="",
        origin="manual",
    )
    attach_evidence(tmp_path, "F-0001", "ev_1", author="张审计")
    attach_evidence(tmp_path, "F-0001", "ev_1", author="张审计")
    assert get_finding(tmp_path, "F-0001")["evidenceRefs"] == ["ev_1"]

    detach_evidence(tmp_path, "F-0001", "ev_1", author="张审计")
    assert get_finding(tmp_path, "F-0001")["evidenceRefs"] == []
```

**Step 2: 运行测试确认失败**

Run: `npm run agent:test -- tests/test_findings_store.py -q`

Expected: `ImportError: cannot import name 'attach_evidence'`。

**Step 3: 实现**

```python
def attach_evidence(
    root: Path, finding_id: str, evidence_id: str, *, author: str | None = None
) -> dict[str, Any] | None:
    root = Path(root)
    if get_finding(root, finding_id) is None:
        return None
    return append_event(
        findings_path(root),
        {
            "event": "evidence_attached",
            "id": finding_id,
            "evidenceId": evidence_id,
            "author": author,
            "ts": now_iso(),
        },
    )


def detach_evidence(
    root: Path, finding_id: str, evidence_id: str, *, author: str | None = None
) -> dict[str, Any] | None:
    root = Path(root)
    finding = get_finding(root, finding_id)
    if finding is None:
        return None
    if evidence_id not in (finding.get("evidenceRefs") or []):
        return None
    return append_event(
        findings_path(root),
        {
            "event": "evidence_detached",
            "id": finding_id,
            "evidenceId": evidence_id,
            "author": author,
            "ts": now_iso(),
        },
    )
```

`fold_findings` 增加：

```python
elif kind == "evidence_attached":
    refs = folded[fid].setdefault("evidenceRefs", [])
    ev = event.get("evidenceId")
    if ev and ev not in refs:
        refs.append(ev)
elif kind == "evidence_detached":
    ev = event.get("evidenceId")
    folded[fid]["evidenceRefs"] = [
        r for r in folded[fid].get("evidenceRefs", []) if r != ev
    ]
```

**Step 4: 运行测试**

Run: `npm run agent:test -- tests/test_findings_store.py -q`

Expected: PASS。

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/findings.py services/agent/tests/test_findings_store.py
git commit -m "feat(findings): attach and detach evidence via events"
```

---

## Task 4: 人工证据与文件落盘（后端）

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/evidence_files.py`
- Modify: `services/agent/src/fireeyeaud_agent/store/evidence.py`
- Test: `services/agent/tests/test_evidence_manual.py`

**Step 1: 写失败测试**

```python
from pathlib import Path

import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store.evidence import append_manual_evidence, load_evidence, verify_evidence_chain
from fireeyeaud_agent.store.findings import create_finding, get_finding


def _manual(root: Path) -> str:
    return create_finding(
        root,
        title="t",
        description="d",
        severity="high",
        dataRefs=[],
        sessionId="",
        origin="manual",
    )["id"]


def test_manual_file_evidence_is_copied_and_hashed(tmp_path):
    fid = _manual(tmp_path)
    src = tmp_path / "回单.pdf"
    src.write_bytes(b"%PDF-1.4 demo")

    ev = append_manual_evidence(
        tmp_path,
        finding_id=fid,
        kind="file",
        title="银行回单",
        note="客户提供",
        source_path=src,
    )

    assert ev["source"] == "manual"
    assert ev["kind"] == "file"
    assert ev["filePath"].startswith("证据/")
    assert ev["fileHash"].startswith("sha256:")
    assert (tmp_path / ev["filePath"]).read_bytes() == b"%PDF-1.4 demo"
    assert get_finding(tmp_path, fid)["evidenceRefs"] == [ev["id"]]
    assert verify_evidence_chain(tmp_path)["ok"] is True


def test_manual_text_evidence(tmp_path):
    fid = _manual(tmp_path)
    ev = append_manual_evidence(
        tmp_path, finding_id=fid, kind="text", title="口头说明", note="财务总监称已对账"
    )
    assert ev["filePath"] is None
    assert load_evidence(tmp_path, fid)[0]["title"] == "口头说明"


def test_manual_file_rejects_unsupported_ext(tmp_path):
    fid = _manual(tmp_path)
    src = tmp_path / "a.exe"
    src.write_bytes(b"x")
    with pytest.raises(ApiError) as exc:
        append_manual_evidence(
            tmp_path, finding_id=fid, kind="file", title="bad", source_path=src
        )
    assert exc.value.code == "E_FILE_TYPE"
```

**Step 2: 运行测试确认失败**

Run: `npm run agent:test -- tests/test_evidence_manual.py -q`

Expected: `cannot import name 'append_manual_evidence'`。

**Step 3: 实现 `evidence_files.py`**

```python
"""人工证据文件：白名单、复制到 证据/、sha256。"""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

from ..errors import ApiError

ALLOWED_EXT = {
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp",
    ".docx", ".doc", ".xlsx", ".xls", ".csv", ".txt", ".md",
    ".eml", ".msg", ".zip",
}
MAX_SIZE = 50 * 1024 * 1024


def copy_into_evidence(root: Path, source: Path) -> tuple[str, int, str]:
    source = Path(source)
    if not source.is_file():
        raise ApiError("E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"path": str(source)})
    if source.suffix.lower() not in ALLOWED_EXT:
        raise ApiError("E_FILE_TYPE", 400, "error.fileType", {"ext": source.suffix})
    size = source.stat().st_size
    if size > MAX_SIZE:
        raise ApiError("E_FILE_TOO_LARGE", 400, "error.fileTooLarge", {"maxMb": 50})

    target_dir = Path(root) / "证据"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / source.name
    n = 2
    while target.exists():
        target = target_dir / f"{source.stem} ({n}){source.suffix}"
        n += 1

    shutil.copy2(source, target)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    rel = target.relative_to(Path(root)).as_posix()
    return rel, size, f"sha256:{digest}"
```

> `error.fileNotFound`、`error.fileType`、`error.fileTooLarge` 加到共享 `error` 命名空间。

**Step 4: 扩展 `append_evidence`**

增加可选参数，保持旧调用不变：

```python
source: str = "agent",
kind: str | None = None,
title: str | None = None,
note: str | None = None,
file_path: str | None = None,
file_hash: str | None = None,
```

写入事件：

```python
if source != "agent":
    event["source"] = source
if kind is not None:
    event["kind"] = kind
if title is not None:
    event["title"] = title
if note is not None:
    event["note"] = note
if file_path is not None:
    event["filePath"] = file_path
if file_hash is not None:
    event["fileHash"] = file_hash
```

**Step 5: 实现 `append_manual_evidence`**

```python
def append_manual_evidence(
    root: Path,
    *,
    finding_id: str,
    kind: str,
    title: str,
    note: str | None = None,
    source_path: Path | None = None,
    author: str | None = None,
) -> dict[str, Any]:
    from .evidence_files import copy_into_evidence
    from .findings import attach_evidence, get_finding

    root = Path(root)
    finding = get_finding(root, finding_id)
    if finding is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": finding_id})
    if kind not in {"file", "text", "record"}:
        raise ApiError("E_INVALID_KIND", 400, "error.internal", {"kind": kind})
    if kind == "file" and source_path is None:
        raise ApiError("E_FILE_REQUIRED", 400, "error.fileRequired")

    file_path = file_hash = None
    if kind == "file" and source_path is not None:
        file_path, _size, file_hash = copy_into_evidence(root, source_path)

    event = append_evidence(
        root,
        session_id="",
        step="manual",
        tool=None,
        params={"kind": kind, "title": title},
        result_summary=note or title,
        finding_refs=[finding_id],
        source="manual",
        kind=kind,
        title=title,
        note=note,
        file_path=file_path,
        file_hash=file_hash,
    )
    attach_evidence(root, finding_id, event["id"], author=author)
    return event
```

**Step 6: 运行测试**

Run: `npm run agent:test -- tests/test_evidence_manual.py -q`

Expected: PASS。

**Step 7: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/evidence.py services/agent/src/fireeyeaud_agent/store/evidence_files.py services/agent/tests/test_evidence_manual.py
git commit -m "feat(evidence): add manual evidence with file hashing"
```

---

## Task 5: API 路由

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/api/findings.py`
- Modify: `services/agent/src/fireeyeaud_agent/api/evidence.py`
- Test: `services/agent/tests/test_findings_manual_api.py`

**Step 1: 写失败测试**

```python
import httpx

from fireeyeaud_agent.main import app


async def test_manual_finding_and_evidence_api(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})

        created = await client.post(
            "/api/v1/findings",
            json={
                "title": "手工疑点",
                "description": "说明",
                "severity": "high",
                "subjects": ["应收账款"],
                "amount": "1000",
                "author": "张审计",
            },
        )
        assert created.status_code == 201
        fid = created.json()["id"]

        src = tmp_path / "回单.pdf"
        src.write_bytes(b"%PDF-1.4 demo")
        added = await client.post(
            f"/api/v1/findings/{fid}/evidence",
            json={"kind": "file", "title": "银行回单", "note": "客户提供", "path": str(src)},
        )
        assert added.status_code == 201
        ev_id = added.json()["evidence"]["id"]
        assert (tmp_path / "证据" / "回单.pdf").is_file()

        listed = (await client.get(f"/api/v1/findings/{fid}")).json()
        assert listed["evidenceRefs"] == [ev_id]

        removed = await client.delete(f"/api/v1/findings/{fid}/evidence/{ev_id}")
        assert removed.status_code == 200
        assert (await client.get(f"/api/v1/findings/{fid}")).json()["evidenceRefs"] == []

        deleted = await client.delete(f"/api/v1/findings/{fid}")
        assert deleted.status_code == 200
        assert (await client.get(f"/api/v1/findings/{fid}")).status_code == 404
```

**Step 2: 运行测试确认失败**

Run: `npm run agent:test -- tests/test_findings_manual_api.py -q`

Expected: 404（路由不存在）。

**Step 3: 实现路由**

`api/findings.py`：

```python
class CreateFindingBody(BaseModel):
    title: str
    description: str | None = None
    severity: str = "medium"
    subjects: list[str] = []
    amount: str | None = None
    currency: str = "CNY"
    author: str = "审计员"
    lang: str = "zh-CN"


class EvidenceBody(BaseModel):
    kind: str
    title: str
    note: str | None = None
    path: str | None = None


@router.post("/findings", status_code=201)
def create_manual(body: CreateFindingBody) -> dict:
    return create_finding(
        _root(),
        title=body.title,
        description=body.description,
        severity=body.severity,
        dataRefs=[],
        sessionId="",
        lang=body.lang,
        subjects=body.subjects,
        amount=body.amount,
        currency=body.currency,
        origin="manual",
        author=body.author,
    )


@router.delete("/findings/{finding_id}")
def delete_one(finding_id: str, author: str = "审计员") -> dict:
    result = delete_finding(_root(), finding_id, author=author)
    if result is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": finding_id})
    return {"ok": True, "id": finding_id}


@router.post("/findings/{finding_id}/evidence", status_code=201)
def add_evidence(finding_id: str, body: EvidenceBody) -> dict:
    if body.kind == "file" and not body.path:
        raise ApiError("E_FILE_REQUIRED", 400, "error.fileRequired")
    event = append_manual_evidence(
        _root(),
        finding_id=finding_id,
        kind=body.kind,
        title=body.title,
        note=body.note,
        source_path=Path(body.path) if body.path else None,
        author="审计员",
    )
    return {"evidence": event, "finding": get_finding(_root(), finding_id)}


@router.delete("/findings/{finding_id}/evidence/{evidence_id}")
def remove_evidence(finding_id: str, evidence_id: str) -> dict:
    result = detach_evidence(_root(), finding_id, evidence_id, author="审计员")
    if result is None:
        raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": evidence_id})
    return {"ok": True, "finding": get_finding(_root(), finding_id)}
```

> 直接 `Path(body.path)` 只接受绝对路径；Electron `openFiles` 返回绝对路径。后端 `copy_into_evidence` 只用 `source.name`，不拼接用户路径，避免穿越。

**Step 4: 运行测试**

Run: `npm run agent:test -- tests/test_findings_manual_api.py -q`

Expected: PASS。

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/api/findings.py services/agent/tests/test_findings_manual_api.py
git commit -m "feat(api): add manual finding and evidence routes"
```

---

## Task 6: 前端 API 与 Store

**Files:**
- Modify: `apps/renderer/src/lib/api.ts`
- Modify: `apps/renderer/src/store/findings.ts`
- Modify: `apps/renderer/src/store/ui.ts`

**Step 1: `api.ts` 增加类型与调用**

```ts
export interface CreateFindingInput {
  title: string;
  description?: string;
  severity: string;
  subjects?: string[];
  amount?: string;
  currency?: string;
  author?: string;
  lang?: string;
}

export function createFindingApi(input: CreateFindingInput): Promise<Finding> {
  return request<Finding>('/findings', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteFindingApi(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/findings/${id}`, { method: 'DELETE' });
}

export interface AddEvidenceInput {
  kind: 'file' | 'text' | 'record';
  title: string;
  note?: string;
  path?: string;
}

export function addFindingEvidenceApi(
  findingId: string,
  input: AddEvidenceInput,
): Promise<{ evidence: EvidenceItem; finding: Finding }> {
  return request(`/findings/${findingId}/evidence`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function removeFindingEvidenceApi(
  findingId: string,
  evidenceId: string,
): Promise<{ ok: boolean; finding: Finding }> {
  return request(`/findings/${findingId}/evidence/${evidenceId}`, {
    method: 'DELETE',
  });
}
```

**Step 2: `findings.ts` 增加多选与写操作**

```ts
interface FindingsState {
  items: Finding[];
  selectedIds: string[];
  loading: boolean;
  errorKey: string | null;
  load: (params?: { severity?: string; status?: string; limit?: number }) => Promise<void>;
  create: (input: CreateFindingInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  review: (id: string, body: ReviewInput) => Promise<void>;
  toggleSelected: (id: string) => void;
  clearSelected: () => void;
  reset: () => void;
}
```

实现要点：

- `create` / `remove` 调用 API 后 `await get().load()`，并清空已删除项的选择。
- `toggleSelected` 用数组去重。
- `reset` 清空 `items` 与 `selectedIds`。

**Step 3: `ui.ts` 改 tab 类型**

```ts
export type ResultsTab = 'findings' | 'evidence-form' | 'report' | 'archive';
```

**Step 4: 运行类型检查**

Run: `npm run renderer:typecheck`

Expected: 失败点收敛到 `ResultsColumn.tsx`。

**Step 5: Commit**

```bash
git add apps/renderer/src/lib/api.ts apps/renderer/src/store/findings.ts apps/renderer/src/store/ui.ts
git commit -m "feat(renderer): add findings api and result tab types"
```

---

## Task 7: 成果栏骨架与占位视图

**Files:**
- Create: `apps/renderer/src/components/results/EvidenceFormsView.tsx`
- Create: `apps/renderer/src/components/results/ReportsView.tsx`
- Create: `apps/renderer/src/components/results/ArchiveView.tsx`
- Modify: `apps/renderer/src/components/ResultsColumn.tsx`

**Step 1: 占位组件**

```tsx
// 取证单/报告/归档在后续计划实现；先保证 tab 可用。
export function EvidenceFormsView() {
  const { t } = useTranslation('results');
  return <div className="panel-empty">{t('empty')}</div>;
}
```

`ReportsView`、`ArchiveView` 结构相同。

**Step 2: 改 `ResultsColumn`**

```tsx
const TABS: ResultsTab[] = ['findings', 'evidence-form', 'report', 'archive'];

const TAB_LABEL_KEY: Record<ResultsTab, string> = {
  findings: 'findings',
  'evidence-form': 'evidenceForm',
  report: 'report',
  archive: 'archive',
};
```

渲染分支改为：

```tsx
{resultsTab === 'findings' ? (
  <FindingsView />
) : resultsTab === 'evidence-form' ? (
  <EvidenceFormsView />
) : resultsTab === 'report' ? (
  <ReportsView />
) : (
  <ArchiveView />
)}
```

移除 `GraphView`、`WorkingPaperView` 的 import。旧文件保留，不在本计划删除。

**Step 3: 运行类型检查与构建**

Run: `npm run renderer:typecheck`

Expected: PASS。

Run: `npm run renderer:build`

Expected: PASS。

**Step 4: Commit**

```bash
git add apps/renderer/src/components/ResultsColumn.tsx apps/renderer/src/components/results
git commit -m "feat(results): switch to findings forms reports archive tabs"
```

---

## Task 8: 疑点列表多选、新建与删除

**Files:**
- Create: `apps/renderer/src/components/results/FindingsView.tsx`
- Create: `apps/renderer/src/components/results/FindingCard.tsx`
- Create: `apps/renderer/src/components/results/NewFindingDialog.tsx`
- Modify: `apps/renderer/src/components/ResultsColumn.tsx`
- Modify: `apps/renderer/src/styles/global.css`

**Step 1: 新建疑点弹窗**

字段：标题（必填）、描述、风险等级、涉及科目（逗号分隔）、金额、币种。提交：

```tsx
await create({
  title: title.trim(),
  description: description.trim() || undefined,
  severity,
  subjects: subjects.split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
  amount: amount.trim() || undefined,
  currency: 'CNY',
  author: '审计员',
});
```

成功后 `message.success(tc('saved'))` 并关闭。

**Step 2: 疑点卡片**

- 左侧 checkbox（`e.stopPropagation()`），用于多选。
- 头部保留展开箭头、severity、ID、status。
- 新增「删除」icon 按钮（`Trash2`），确认后调用 `remove(finding.id)`。
- 手动疑点显示 `manualBadge`。
- 点击标题区域展开详情，同时 `setSelectedFindingId(id)`。

**Step 3: 列表页**

- 统计行保留高/中/低风险。
- 工具栏：左侧「新建疑点」按钮；右侧显示 `selected` 与「清空选择」。
- 列表为空时显示 `empty`。
- `FindingsView` 移到 `components/results/FindingsView.tsx`，`ResultsColumn` 只 import。

**Step 4: 样式**

在 `global.css` 追加：

```css
.findings-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.finding__check { margin-right: 4px; }
.finding__delete { opacity: 0; transition: opacity .15s; }
.finding:hover .finding__delete { opacity: 1; }
.finding__detail--split { display: flex; flex-direction: column; gap: 12px; }
.finding__content { border: 1px solid var(--border); border-radius: 6px; padding: 10px; }
.finding__evidence { border-top: 1px dashed var(--border); padding-top: 10px; }
```

**Step 5: 手测**

Run: `npm run dev`

检查：新建 → 列表出现 → 刷新仍在；删除 → 列表消失；勾选多条 → 已选数量正确。

**Step 6: Commit**

```bash
git add apps/renderer/src/components/results apps/renderer/src/components/ResultsColumn.tsx apps/renderer/src/styles/global.css
git commit -m "feat(results): add finding multi-select create and delete"
```

---

## Task 9: 疑点详情上下分块与证据操作

**Files:**
- Modify: `apps/renderer/src/components/FindingDetail.tsx`
- Create: `apps/renderer/src/components/results/AddEvidenceDialog.tsx`
- Modify: `apps/renderer/src/styles/global.css`

**Step 1: 重排详情**

结构：

```tsx
<div className="finding__detail finding__detail--split">
  {/* 上：疑点内容 */}
  <section className="finding__content">
    <div className="finding__content-title">{t('detailContent')}</div>
    {/* 描述、科目、金额、ruleKey、sessionId */}
    {/* 复核按钮组与复核记录 */}
  </section>

  {/* 下：证据 */}
  <section className="finding__evidence">
    <div className="evidence-block__title">
      {t('detailEvidence')}
      <span className="spacer" />
      <button className="button button--sm" onClick={() => setAddOpen(true)}>
        <Plus size={12} /> {t('addEvidence')}
      </button>
    </div>
    {evidence.map((item) => (
      <EvidenceRow key={item.id} item={item} onRemove={...} />
    ))}
  </section>
</div>
```

**Step 2: 证据行**

- 图标：文件用 `Paperclip`，文字用 `MessageSquare`，记录用 `ClipboardCheck`。
- 展示 `title ?? resultSummary ?? tool ?? step`，以及 `note`。
- 文件证据显示「预览」按钮：`openPreview(root, absPath, name)`。`absPath = root + '/' + filePath`（POSIX 相对路径）。
- 显示「移除」按钮：确认后 `removeFindingEvidenceApi(finding.id, item.id)`，重新拉取证据并 `findings.load()` 刷新 `evidenceRefs`。

**Step 3: 补充证据弹窗**

`AddEvidenceDialog` 用 antd `Modal` + 三段式选择（`Segmented` 或三个 radio 卡片）：

- 文件：标题必填，按钮 `window.fireeyeaud.openFiles('attachments')`，只取第一个路径；显示文件名。
- 文字：标题 + 多行说明。
- 记录：标题 + 核查过程/结论。

提交：

```tsx
await addFindingEvidenceApi(findingId, {
  kind,
  title: title.trim(),
  note: note.trim() || undefined,
  path: kind === 'file' ? chosenPath : undefined,
});
```

成功后关闭并刷新。

**Step 4: 样式**

```css
.evidence-item__main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.evidence-item__title { font-weight: 500; }
.evidence-item__note { color: var(--text-muted); font-size: 12px; }
.evidence-item__actions { display: flex; gap: 4px; }
```

**Step 5: 手测**

- 上传 PDF → 出现在证据区 → 点击预览能打开。
- 文字/记录不产生文件，但出现在证据区。
- 移除 → 证据区消失；`GET /evidence?findingId=` 仍返回该证据（日志保留）。
- 删除疑点后证据仍在 `证据/` 和日志中。

**Step 6: Commit**

```bash
git add apps/renderer/src/components/FindingDetail.tsx apps/renderer/src/components/results/AddEvidenceDialog.tsx apps/renderer/src/styles/global.css
git commit -m "feat(findings): split detail and support evidence supplement"
```

---

## Task 10: 全量验证

**Step 1: 后端测试**

Run: `npm run agent:test`

Expected: 全绿。

**Step 2: 前端类型与构建**

Run: `npm run renderer:typecheck`

Run: `npm run renderer:build`

Expected: 全绿。

**Step 3: 桌面测试**

Run: `npm run desktop:test`

Expected: 全绿。

**Step 4: 手工回归**

1. Agent 生成疑点仍出现在列表，展开、复核正常。
2. 人工新建疑点，`origin=manual`，刷新后仍在。
3. 删除疑点后刷新不回来；已生成的底稿不受影响。
4. 上传证据文件，确认落到 `证据/`；移除后文件仍在。
5. 证据链校验接口（若 UI 暂无入口，用 `GET /api/v1/evidence` + 后端测试覆盖）仍完整。

**Step 5: Commit（如有测试修正）**

```bash
git add -A
git commit -m "test: verify findings and evidence redesign"
```

---

## 验收标准

- 成果栏只有「疑点 / 取证单 / 项目报告 / 归档」四个 tab。
- 手动创建、删除疑点可用，删除为软删除。
- 疑点详情上方内容、下方证据。
- 证据可上传文件、写文字、写记录；可预览文件；可从疑点移除。
- 证据移除不破坏哈希链，证据日志仍保留。
- 多选状态可供 P3 读取。
