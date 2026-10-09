# Phase 3 — 证据图谱可视化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 建议按里程碑（K→L→M）分批执行，每个里程碑结束运行一次验证并以一次提交收尾。

**Goal:** 在成果栏「图谱」tab 以关系图展示「疑点 → 数据 → 凭证 → 规则/工具」的关联；与疑点列表联动，点击节点查看详情、点击疑点节点跳回疑点清单。

**Architecture:** 后端新增 `store/graph.py` 由 `findings` + `evidence` + `schema.json` **实时派生**图谱（不落盘），经 `GET /graph?findingId` 返回 `{nodes, edges}`；前端用 Cytoscape.js（内置布局）渲染，`GraphView` 挂载在 `ResultsColumn` 的 `graph` tab，通过 `ui` store 的 `selectedFindingId` 与疑点列表联动。

**Tech Stack:** Python 3.12 · FastAPI · React 18 · Zustand · Cytoscape.js

---

## 决策与偏差（执行前须知，2026-10-09 用户确认）

1. **图谱范围**：默认全工作区图谱；在疑点列表选中某条时聚焦/高亮其子图（同一 `F-00xx` 贯穿）。
2. **节点点击**：任意节点弹**节点详情卡**（id/类型/属性/关联证据）；点击 `finding` 节点→切回疑点清单并选中。行级数据预览推迟（当前无数据表格查看器）。
3. **图谱库/布局**：Cytoscape.js + 内置 `cose` / `breadthfirst`，不引入 dagre 插件。
4. **派生范围（只派生确定项）**：节点 `finding` / `dataset` / `voucher` / `rule` / `tool`；边 `derived_from`（finding→dataset）、`references`（finding→voucher）、`verified_by`（finding→rule / finding→tool）。`subject` / `party` 节点推迟到有凭证/关联方解析数据的阶段。
5. **不缓存**：图谱由现状实时派生，不写 `artifacts/`。

---

## 里程碑总览

| 里程碑 | 内容 | 交付 |
|---|---|---|
| K | 后端图谱派生 + `GET /graph` | 可派生 `{nodes, edges}`，支持 `?findingId` |
| L | 前端图谱视图 + 联动 | 成果栏「图谱」tab 可交互 |
| M | 端到端验收 + 文档 | 完整 Phase 3 |

---

## 里程碑 K — 后端图谱派生

### Task K1: 图谱派生（finding/dataset/voucher/rule/tool）

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/graph.py`
- Test: `services/agent/tests/test_graph_store.py`

**Step 1: 写失败测试**

```python
from fireeyeaud_agent.store.evidence import append_evidence
from fireeyeaud_agent.store.findings import create_finding
from fireeyeaud_agent.store.graph import build_graph


def test_build_graph_derives_nodes_and_edges(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    ev = append_evidence(
        tmp_path, session_id="s_1", step="tool_call", tool="sql_query"
    )
    create_finding(
        tmp_path,
        title="大额",
        description="d",
        severity="high",
        dataRefs=[{"sourceId": "ds_1", "table": "src_ds1_序时账", "rowRef": "1182"}],
        sessionId="s_1",
        ruleKey="tie_check",
        evidenceRefs=[ev["id"]],
    )
    graph = build_graph(tmp_path)
    ids = {n["id"] for n in graph["nodes"]}
    assert "finding:F-0001" in ids
    assert "dataset:src_ds1_序时账" in ids
    assert "voucher:src_ds1_序时账#1182" in ids
    assert "rule:tie_check" in ids
    assert "tool:sql_query" in ids

    edge_types = {e["edgeType"] for e in graph["edges"]}
    assert {"derived_from", "references", "verified_by"} <= edge_types


def test_build_graph_filters_by_finding(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    a = create_finding(
        tmp_path, title="a", description="d", severity="low", dataRefs=[], sessionId="s_1"
    )
    b = create_finding(
        tmp_path, title="b", description="d", severity="low", dataRefs=[], sessionId="s_1"
    )
    graph = build_graph(tmp_path, a["id"])
    assert [n["id"] for n in graph["nodes"]] == [f"finding:{a['id']}"]
    assert b["id"] not in {n["refId"] for n in graph["nodes"]}


def test_build_graph_empty_workspace(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    assert build_graph(tmp_path) == {"nodes": [], "edges": []}
```

**Step 2: 运行失败**

Run: `cd services/agent && uv run pytest tests/test_graph_store.py -v`
Expected: FAIL（`ModuleNotFoundError`）

**Step 3: 实现 `store/graph.py`**

```python
"""证据图谱派生（设计 §14.11）。

图谱不落盘：由 findings + evidence + schema 在展示时派生。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .evidence import load_evidence
from .findings import load_findings


def build_graph(root: Path, finding_id: str | None = None) -> dict[str, Any]:
    root = Path(root)
    findings = load_findings(root)
    if finding_id:
        findings = [f for f in findings if f.get("id") == finding_id]

    evidence_by_id = {e["id"]: e for e in load_evidence(root, limit=100000)}

    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[str, dict[str, Any]] = {}

    def add_node(
        node_type: str, ref_id: str, label: str, meta: dict[str, Any] | None = None
    ) -> str:
        nid = f"{node_type}:{ref_id}"
        if nid not in nodes:
            nodes[nid] = {
                "id": nid,
                "nodeType": node_type,
                "refId": ref_id,
                "label": label,
                "meta": meta or {},
            }
        return nid

    def add_edge(source: str, target: str, edge_type: str) -> None:
        eid = f"{edge_type}:{source}->{target}"
        if eid not in edges:
            edges[eid] = {
                "id": eid,
                "source": source,
                "target": target,
                "edgeType": edge_type,
            }

    for finding in findings:
        fid = finding.get("id")
        if not fid:
            continue
        fnode = add_node(
            "finding",
            fid,
            fid,
            {
                "severity": finding.get("severity"),
                "status": finding.get("status"),
                "origin": finding.get("origin"),
            },
        )
        for ref in finding.get("dataRefs") or []:
            table = ref.get("table")
            if not table:
                continue
            dnode = add_node("dataset", table, table)
            add_edge(fnode, dnode, "derived_from")
            row = ref.get("rowRef")
            if row:
                vnode = add_node("voucher", f"{table}#{row}", str(row))
                add_edge(fnode, vnode, "references")
        rule_key = finding.get("ruleKey")
        if rule_key:
            rnode = add_node("rule", rule_key, rule_key)
            add_edge(fnode, rnode, "verified_by")
        for ev_id in finding.get("evidenceRefs") or []:
            ev = evidence_by_id.get(ev_id)
            tool = ev.get("tool") if ev else None
            if tool:
                tnode = add_node("tool", tool, tool)
                add_edge(fnode, tnode, "verified_by")

    return {"nodes": list(nodes.values()), "edges": list(edges.values())}
```

**Step 4: 运行通过**

Run: `cd services/agent && uv run pytest tests/test_graph_store.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/graph.py services/agent/tests/test_graph_store.py
git commit -m "feat(agent): 证据图谱派生（finding/dataset/voucher/rule/tool）"
```

---

### Task K2: 图谱 REST API

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/api/graph.py`
- Modify: `services/agent/src/fireeyeaud_agent/main.py`
- Test: `services/agent/tests/test_graph_api.py`

**Step 1: 写失败测试**

```python
import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store.findings import create_finding


async def test_graph_api(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        create_finding(
            tmp_path,
            title="t",
            description="d",
            severity="high",
            dataRefs=[{"sourceId": "ds_1", "table": "t1", "rowRef": "1"}],
            sessionId="s_1",
        )
        graph = (await client.get("/api/v1/graph")).json()
        assert any(n["id"] == "finding:F-0001" for n in graph["nodes"])
        assert any(e["edgeType"] == "derived_from" for e in graph["edges"])

        sub = (await client.get("/api/v1/graph?findingId=F-0001")).json()
        assert {n["nodeType"] for n in sub["nodes"]} <= {"finding", "dataset", "voucher"}
        await client.post("/api/v1/workspaces/close")


async def test_graph_api_no_workspace():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/v1/graph")).json() == {"nodes": [], "edges": []}
```

**Step 2: 运行失败** — `uv run pytest tests/test_graph_api.py -v` → FAIL（404）

**Step 3: 实现 `api/graph.py`**

```python
"""证据图谱路由（设计 §14.8 / §14.11）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..store.graph import build_graph
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["graph"], dependencies=[Depends(require_token)])


@router.get("/graph")
def get_graph(findingId: str | None = None) -> dict:
    if workspace_manager.root is None:
        return {"nodes": [], "edges": []}
    return build_graph(workspace_manager.root, findingId)
```

`main.py`：`from .api import ... graph ...`；在 `rules` 后 `app.include_router(graph.router, prefix=API_PREFIX)`。

**Step 4: 运行通过** — `uv run pytest tests/test_graph_api.py -v` → PASS

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/api/graph.py services/agent/src/fireeyeaud_agent/main.py services/agent/tests/test_graph_api.py
git commit -m "feat(agent): 证据图谱 REST"
```

---

## 里程碑 L — 前端图谱视图

### Task L1: 依赖 + 类型 + API + store

**Files:**
- Modify: `apps/renderer/package.json`（新增 `cytoscape`、`@types/cytoscape`）
- Modify: `packages/shared/src/types.ts`（`GraphNode` / `GraphEdge` / `GraphData`）
- Modify: `apps/renderer/src/lib/api.ts`（`getGraph`）
- Create: `apps/renderer/src/store/graph.ts`
- Modify: `apps/renderer/src/store/ui.ts`（`selectedFindingId`）

**Step 1: 安装依赖**

Run: `npm install -w @fireeyeaud/renderer cytoscape@^3.30.0 && npm install -w @fireeyeaud/renderer -D @types/cytoscape@^3.21.0`
Expected: `package.json` / `package-lock.json` 更新。

**Step 2: 类型（`types.ts`）**

```ts
export type GraphNodeType = 'finding' | 'dataset' | 'voucher' | 'rule' | 'tool';
export type GraphEdgeType = 'derived_from' | 'references' | 'involves' | 'verified_by';

export interface GraphNode {
  id: string;
  nodeType: GraphNodeType;
  refId: string;
  label: string;
  meta: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  edgeType: GraphEdgeType;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

**Step 3: API（`lib/api.ts`）**

```ts
export function getGraph(findingId?: string): Promise<GraphData> {
  const qs = findingId ? `?findingId=${encodeURIComponent(findingId)}` : '';
  return request<GraphData>(`/graph${qs}`);
}
```

（`GraphData` 加入顶部 `@fireeyeaud/shared` 类型导入。）

**Step 4: store（`store/graph.ts`）**

```ts
import { create } from 'zustand';
import type { GraphData, GraphNode } from '@fireeyeaud/shared';
import { getGraph } from '../lib/api';

interface GraphState {
  data: GraphData;
  selectedNode: GraphNode | null;
  loading: boolean;
  errorKey: string | null;
  load: (findingId?: string) => Promise<void>;
  selectNode: (node: GraphNode | null) => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  data: { nodes: [], edges: [] },
  selectedNode: null,
  loading: false,
  errorKey: null,
  load: async (findingId) => {
    set({ loading: true, errorKey: null });
    try {
      const data = await getGraph(findingId);
      set({ data, loading: false });
    } catch (err) {
      set({
        loading: false,
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal',
      });
    }
  },
  selectNode: (node) => set({ selectedNode: node }),
}));
```

**Step 5: ui store 增选中态（`store/ui.ts`）**

```ts
interface UiState {
  activeView: ActivityView;
  sidebarOpen: boolean;
  resultsTab: ResultsTab;
  selectedFindingId: string | null;
  setActiveView: (view: ActivityView) => void;
  setResultsTab: (tab: ResultsTab) => void;
  setSelectedFindingId: (id: string | null) => void;
}
...
  selectedFindingId: null,
  setSelectedFindingId: (id) => set({ selectedFindingId: id }),
```

**Step 6: 验证**

Run: `npm run renderer:typecheck`
Expected: 无错误

**Step 7: Commit**

```bash
git add apps/renderer/package.json package-lock.json packages/shared/src/types.ts apps/renderer/src/lib/api.ts apps/renderer/src/store/graph.ts apps/renderer/src/store/ui.ts
git commit -m "feat(renderer): 图谱类型、API 与 store"
```

---

### Task L2: GraphView 组件 + 联动 + i18n

**Files:**
- Create: `apps/renderer/src/components/GraphView.tsx`
- Modify: `apps/renderer/src/components/ResultsColumn.tsx`
- Modify: `packages/shared/src/locales/{zh-CN,en-US}.ts`（`graph`/`results` 补 key）
- Modify: `apps/renderer/src/styles/global.css`

**Step 1: 实现 `GraphView.tsx`**

要点：
- `useRef` 保存容器与 `cytoscape.Core` 实例；`useEffect`（空依赖）初始化实例并注册 `tap node` → `selectNode` + `setSelectedFindingId`（当 `nodeType === 'finding'` 且 `setResultsTab('findings')`）。
- 第二个 `useEffect`（依赖 `data`）清空后 `cy.add()` 节点与边；节点 `data` 平铺 `id/label/nodeType`；边 `data` `source/target/edgeType`。
- 样式：`node[nodeType="finding"]` 等 selector 设颜色/形状；颜色用 `getComputedStyle(document.documentElement).getPropertyValue('--accent')` 等令牌；`edge[edgeType]` 设线型（`references` 虚线）。
- 布局：`nodes.length > 30 ? 'cose' : 'breadthfirst'`。
- 选中聚焦：当 `selectedFindingId` 变化，`cy.getElementById('finding:'+id)` 高亮并 `cy.animate` 居中；其余元素降透明度。
- 顶部提示 `t('hint')`；空图显示 `t('empty')`。
- 底部/浮层 **节点详情卡**：显示 `selectedNode.id / nodeType / label` 与 `meta` 键值；`finding` 节点附「查看疑点」按钮（`setResultsTab('findings')` + `setSelectedFindingId`）。

参考实现（完整）：

```tsx
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import cytoscape from 'cytoscape';
import type { GraphEdge, GraphNode } from '@fireeyeaud/shared';
import { useGraphStore } from '../store/graph';
import { useUiStore } from '../store/ui';

function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

const NODE_COLOR: Record<string, string> = {
  finding: 'accent',
  dataset: 'info',
  voucher: 'warning',
  rule: 'success',
  tool: 'text-3',
};

export function GraphView() {
  const { t } = useTranslation('graph');
  const { t: te } = useTranslation('enums');
  const data = useGraphStore((s) => s.data);
  const load = useGraphStore((s) => s.load);
  const selectedNode = useGraphStore((s) => s.selectedNode);
  const selectNode = useGraphStore((s) => s.selectNode);
  const selectedFindingId = useUiStore((s) => s.selectedFindingId);
  const setSelectedFindingId = useUiStore((s) => s.setSelectedFindingId);
  const setResultsTab = useUiStore((s) => s.setResultsTab);

  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!containerRef.current || cyRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      wheelSensitivity: 0.2,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'font-size': 10,
            color: token('--text-1', '#222'),
            'background-color': token('--text-3', '#888'),
            'border-width': 1,
            'border-color': token('--border-strong', '#ccc'),
            width: 18,
            height: 18,
          },
        },
        ...Object.entries(NODE_COLOR).map(([type, tokenName]) => ({
          selector: `node[nodeType = "${type}"]`,
          style: { 'background-color': token(`--${tokenName}`, '#888') },
        })),
        {
          selector: 'node:selected',
          style: { 'border-width': 3, 'border-color': token('--accent', '#4c8dff') },
        },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': token('--border-strong', '#ccc'),
            'target-arrow-color': token('--border-strong', '#ccc'),
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'font-size': 8,
            color: token('--text-3', '#888'),
            label: 'data(edgeType)',
          },
        },
        {
          selector: 'edge[edgeType = "references"]',
          style: { 'line-style': 'dashed' },
        },
      ],
      layout: { name: 'breadthfirst', directed: true },
    });
    cy.on('tap', 'node', (evt) => {
      const d = evt.target.data() as GraphNode & { nodeType: string };
      selectNode({
        id: d.id,
        nodeType: d.nodeType as GraphNode['nodeType'],
        refId: d.refId,
        label: d.label,
        meta: d.meta ?? {},
      });
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) selectNode(null);
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [selectNode]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().remove();
    const elements = [
      ...data.nodes.map((n: GraphNode) => ({
        data: { id: n.id, label: n.label, nodeType: n.nodeType, refId: n.refId, meta: n.meta },
      })),
      ...data.edges.map((e: GraphEdge) => ({
        data: { id: e.id, source: e.source, target: e.target, edgeType: e.edgeType },
      })),
    ];
    cy.add(elements as cytoscape.ElementDefinition[]);
    cy.layout({
      name: data.nodes.length > 30 ? 'cose' : 'breadthfirst',
      directed: true,
      padding: 24,
    } as cytoscape.LayoutOptions).run();
  }, [data]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('faded focused');
    cy.getElementById(`finding:${selectedFindingId}`);
    if (selectedFindingId) {
      const node = cy.getElementById(`finding:${selectedFindingId}`);
      if (node.nonempty()) {
        cy.elements().addClass('faded');
        node.removeClass('faded').addClass('focused');
        node.neighborhood().removeClass('faded');
        cy.animate({ center: { eles: node } }, { duration: 200 });
      }
    }
  }, [selectedFindingId]);

  return (
    <div className="graph-wrap">
      <div className="graph-hint">{t('hint')}</div>
      {data.nodes.length === 0 && <div className="panel-empty">{t('empty')}</div>}
      <div ref={containerRef} className="graph-canvas" />
      {selectedNode && (
        <div className="graph-detail">
          <div className="graph-detail__head">
            <span className="scope-badge">{te(`nodeType.${selectedNode.nodeType}`)}</span>
            <span className="card__name">{selectedNode.label}</span>
            {selectedNode.nodeType === 'finding' && (
              <button
                type="button"
                className="button button--sm"
                onClick={() => {
                  setSelectedFindingId(selectedNode.refId);
                  setResultsTab('findings');
                }}
              >
                {t('openFinding')}
              </button>
            )}
          </div>
          <pre className="graph-detail__body">{JSON.stringify(selectedNode.meta, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
```

> 说明：`faded` 类需通过 cytoscape 样式映射实现——在 style 数组中追加：
> ```ts
> { selector: '.faded', style: { opacity: 0.25 } },
> { selector: '.focused', style: { 'border-width': 4, 'border-color': token('--accent', '#4c8dff') } },
> ```

**Step 2: `ResultsColumn.tsx` 接入**

```tsx
import { GraphView } from './GraphView';
...
  {resultsTab === 'findings' ? (
    <FindingsView />
  ) : resultsTab === 'graph' ? (
    <GraphView />
  ) : (
    <EmptyView />
  )}
```

疑点卡片点击联动：在 `FindingCard` 的展开按钮 `onClick` 里追加
`useUiStore.getState().setSelectedFindingId(finding.id);`（或提升到组件内读取 setter）。

**Step 3: i18n**

新增 `graph` 命名空间（`packages/shared/src/locales/{zh-CN,en-US}.ts`）：

```ts
// zh-CN
graph: {
  hint: '点击节点查看详情；点击疑点节点跳转疑点清单',
  empty: '暂无可视化数据',
  openFinding: '查看疑点',
},
// en-US
graph: {
  hint: 'Click a node for details; click a finding node to open it',
  empty: 'No graph data yet',
  openFinding: 'Open finding',
},
```

（`namespaces` 列表在 `packages/shared/src/locales/index.ts` 中新增 `'graph'`。）

**Step 4: CSS（`global.css`）**

```css
.graph-wrap { display: flex; flex-direction: column; gap: 8px; height: 100%; position: relative; }
.graph-hint { font-size: 11px; color: var(--text-3); }
.graph-canvas { flex: 1; min-height: 260px; background: var(--editor-bg); border: 1px solid var(--border); border-radius: 8px; }
.graph-detail { background: var(--editor-bg); border: 1px solid var(--border-strong); border-radius: 8px; padding: 10px; }
.graph-detail__head { display: flex; align-items: center; gap: 8px; }
.graph-detail__body { font-family: var(--font-mono); font-size: 11px; color: var(--text-2); white-space: pre-wrap; margin: 6px 0 0; }
```

**Step 5: 验证**

Run: `npm run renderer:typecheck && npm run renderer:build && npm run desktop:test`
Expected: 全部通过

**Step 6: Commit**

```bash
git add apps/renderer/src/components/GraphView.tsx apps/renderer/src/components/ResultsColumn.tsx packages/shared/src/locales/zh-CN.ts packages/shared/src/locales/en-US.ts packages/shared/src/locales/index.ts apps/renderer/src/styles/global.css
git commit -m "feat(renderer): 证据图谱视图与疑点联动"
```

---

## 里程碑 M — 端到端验收

### Task M1: 验收与文档

**Step 1: 后端全量测试**

Run: `cd services/agent && uv run pytest`
Expected: 全绿

**Step 2: 前端检查**

Run: `npm run renderer:typecheck && npm run renderer:build && npm run desktop:test`
Expected: 全绿

**Step 3: 手动 E2E（需真实模型）**

1. `npm run dev`；打开含科目余额表的工作区并导入；
2. 对话产出若干疑点（或设置页规则库 `POST /rules/run` 批量产出）；
3. 成果栏切「图谱」→ 见 `finding → dataset → voucher` 与 `finding → rule/tool` 连线；
4. 点击 `finding` 节点 → 详情卡「查看疑点」→ 跳回疑点清单并选中；
5. 疑点列表选中某条 → 图谱聚焦其子图；点击 `dataset`/`voucher` 节点看详情卡。

**Step 4: 更新 README / 计划文档偏差**

README 状态段追加 Phase 3；本计划末尾追加「Phase 3 实现记录」。

**Step 5: Commit**

```bash
git add -A
git commit -m "docs: Phase 3 验收记录与偏差说明"
```

---

## 风险与注意事项

- **Cytoscape 实例生命周期**：容器元素必须在实例化时已挂载且可见；`graph` tab 未显示时 `ResultsColumn` 不渲染 `GraphView`，切回时重新挂载（本次实现为按需挂载，无需隐藏尺寸处理）。
- **主题令牌读取时机**：`token()` 在实例化时读取；主题切换后需重建实例才能更新配色（Phase 3 接受，主题切换时切 tab 重挂即可）。
- **`getElementById` vs `cy.getElementById`**：使用 cytoscape API 的 `cy.getElementById`。
- **边 id 稳定性**：`<edgeType>:<source>-><target>`，去重保证不重复。
- **节点数过大**：先做常规布局；超大数据量的虚拟化/简化推迟。

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-10-09-phase3-evidence-graph.md`. Two execution options:

**1. Subagent-Driven (this session)** — 每个 Task 派发新的 subagent，任务间我审查（REQUIRED SUB-SKILL: superpowers:subagent-driven-development）。

**2. Parallel Session (separate)** — 新会话用 executing-plans（REQUIRED SUB-SKILL: superpowers:executing-plans）。

Which approach?
