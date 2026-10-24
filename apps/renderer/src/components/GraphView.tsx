import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import cytoscape from 'cytoscape';
import type { GraphEdge, GraphNode } from '@fireeyeaud/shared';
import { useGraphStore } from '../store/graph';
import { useUiStore } from '../store/ui';

function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
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

  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!containerRef.current || cyRef.current) return;
    const style = [
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
        style: {
          'border-width': 3,
          'border-color': token('--accent', '#4c8dff'),
        },
      },
      { selector: '.faded', style: { opacity: 0.25 } },
      {
        selector: '.focused',
        style: {
          'border-width': 4,
          'border-color': token('--accent', '#4c8dff'),
        },
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
    ];
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      wheelSensitivity: 0.2,
      style: style as unknown as cytoscape.StylesheetStyle[],
      layout: { name: 'breadthfirst', directed: true },
    });
    cy.on('tap', 'node', (evt) => {
      const d = evt.target.data() as GraphNode;
      selectNode({
        id: d.id,
        nodeType: d.nodeType,
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
        data: {
          id: n.id,
          label: n.label,
          nodeType: n.nodeType,
          refId: n.refId,
          meta: n.meta,
        },
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
    if (selectedFindingId) {
      const node = cy.getElementById(`finding:${selectedFindingId}`);
      if (node.nonempty()) {
        cy.elements().addClass('faded');
        node.removeClass('faded').addClass('focused');
        node.neighborhood().removeClass('faded');
        cy.animate({ center: { eles: node } }, { duration: 200 });
      }
    }
  }, [selectedFindingId, data]);

  return (
    <div className="graph-wrap">
      <div className="graph-hint">{t('hint')}</div>
      {data.nodes.length === 0 && <div className="panel-empty">{t('empty')}</div>}
      <div ref={containerRef} className="graph-canvas" />
      {selectedNode && (
        <div className="graph-detail">
          <div className="graph-detail__head">
            <span className="scope-badge">
              {te(`nodeType.${selectedNode.nodeType}`)}
            </span>
            <span className="card__name">{selectedNode.label}</span>
            <span className="spacer" />
            {selectedNode.nodeType === 'finding' && (
              <button
                type="button"
                className="button button--sm"
                onClick={() => {
                  setSelectedFindingId(selectedNode.refId);
                }}
              >
                {t('openFinding')}
              </button>
            )}
          </div>
          <pre className="graph-detail__body">
            {JSON.stringify(selectedNode.meta, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
