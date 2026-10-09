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
