from fireeyeaud_agent.store.evidence import append_evidence
from fireeyeaud_agent.store.findings import create_finding
from fireeyeaud_agent.store.graph import build_graph


def test_build_graph_derives_nodes_and_edges(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    ev = append_evidence(tmp_path, session_id="s_1", step="tool_call", tool="sql_query")
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
        tmp_path,
        title="a",
        description="d",
        severity="low",
        dataRefs=[],
        sessionId="s_1",
    )
    b = create_finding(
        tmp_path,
        title="b",
        description="d",
        severity="low",
        dataRefs=[],
        sessionId="s_1",
    )
    graph = build_graph(tmp_path, a["id"])
    assert [n["id"] for n in graph["nodes"]] == [f"finding:{a['id']}"]
    assert b["id"] not in {n["refId"] for n in graph["nodes"]}


def test_build_graph_empty_workspace(tmp_path):
    (tmp_path / ".fireeye").mkdir()
    assert build_graph(tmp_path) == {"nodes": [], "edges": []}
