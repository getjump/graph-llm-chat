import type { AdjacencyList, NodeId } from '../../types';

/**
 * Kahn's Algorithm for topological sorting
 * Returns nodes in dependency order (parents before children)
 *
 * Time Complexity: O(V + E)
 * Space Complexity: O(V)
 */
export function topologicalSort(
  adjacencyList: AdjacencyList,
  nodes: NodeId[]
): NodeId[] {
  // Calculate in-degrees
  const inDegree = new Map<NodeId, number>();
  const nodeSet = new Set(nodes);

  for (const node of nodes) {
    inDegree.set(node, 0);
  }

  for (const node of nodes) {
    const children = adjacencyList[node] || [];
    for (const child of children) {
      if (nodeSet.has(child)) {
        inDegree.set(child, (inDegree.get(child) || 0) + 1);
      }
    }
  }

  // Start with nodes that have no incoming edges
  const queue: NodeId[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) queue.push(node);
  }

  const sorted: NodeId[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const children = adjacencyList[current] || [];
    for (const child of children) {
      if (nodeSet.has(child)) {
        const newDegree = (inDegree.get(child) || 0) - 1;
        inDegree.set(child, newDegree);
        if (newDegree === 0) {
          queue.push(child);
        }
      }
    }
  }

  return sorted;
}
