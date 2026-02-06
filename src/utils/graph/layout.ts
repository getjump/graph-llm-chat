import dagre from 'dagre';
import type { ConversationNode, ConversationEdge, NodeId } from '../../types';

interface LayoutOptions {
  direction: 'TB' | 'BT' | 'LR' | 'RL';
  nodeWidth: number;
  nodeHeight: number;
  nodeSpacing: number;
  rankSpacing: number;
}

const DEFAULT_OPTIONS: LayoutOptions = {
  direction: 'TB',
  nodeWidth: 300,
  nodeHeight: 150,
  nodeSpacing: 50,
  rankSpacing: 100,
};

/**
 * Applies dagre layout to position nodes automatically
 */
export function applyDagreLayout(
  nodes: ConversationNode[],
  edges: ConversationEdge[],
  options: Partial<LayoutOptions> = {}
): Map<NodeId, { x: number; y: number }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const g = new dagre.graphlib.Graph();

  g.setGraph({
    rankdir: opts.direction,
    nodesep: opts.nodeSpacing,
    ranksep: opts.rankSpacing,
  });

  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes
  for (const node of nodes) {
    g.setNode(node.id, {
      width: opts.nodeWidth,
      height: opts.nodeHeight,
    });
  }

  // Add edges
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  // Run layout
  dagre.layout(g);

  // Extract positions
  const positions = new Map<NodeId, { x: number; y: number }>();
  for (const node of nodes) {
    const layoutNode = g.node(node.id);
    if (layoutNode) {
      positions.set(node.id, {
        x: layoutNode.x,
        y: layoutNode.y,
      });
    }
  }

  return positions;
}

/**
 * Apply layout and return nodes with updated positions
 */
export function layoutNodes(
  nodes: ConversationNode[],
  edges: ConversationEdge[],
  options?: Partial<LayoutOptions>
): ConversationNode[] {
  const positions = applyDagreLayout(nodes, edges, options);

  return nodes.map((node) => {
    const pos = positions.get(node.id);
    return pos
      ? { ...node, position: pos }
      : node;
  });
}
